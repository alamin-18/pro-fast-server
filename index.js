const express = require('express');
const bodyParser = require('body-parser');

const cors = require('cors');

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Sample route
app.get('/', (req, res) => {
    res.send('Hello, Pro Fast Server is running!');
});


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fr2ognn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const db = client.db('parcelDB');
        const usersCollection = db.collection('users');
        const parcelsCollection = db.collection('parcels');
        const paymentsCollection = db.collection('payments');
        const ridersCollection = db.collection('riders');

        // users api
        app.post('/users', async (req, res) => {
            try {
                const user = req.body;
                const exists = await usersCollection.findOne({ email: user.email });
                if (exists) {
                    return res.status(409).send({ message: 'User already exists' });
                };
                const result = await usersCollection.insertOne(user);
                res.status(201).send(result);
            }
            catch (error) {
                console.error('Error inserting user:', error);
                res.status(500).send({ message: 'Failed to create user' });
            }
        });
        app.get("/users/search", async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });
        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });
        app.patch("/users/:id/role", async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            // Allow more roles (add what you need)
            const validRoles = ["admin", "user", "suspended", "rider"];
            if (!validRoles.includes(role)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            try {
                let filter;
                if (ObjectId.isValid(id)) {
                    filter = { _id: new ObjectId(id) };
                } else {
                    filter = { _id: id }; // fallback if you store string IDs
                }

                const result = await usersCollection.updateOne(filter, {
                    $set: { role },
                });

                res.send({
                    modifiedCount: result.modifiedCount,
                    message: `User role updated to ${role}`,
                });
            } catch (error) {
                console.error("Error updating user role", error);
                res
                    .status(500)
                    .send({ message: "Failed to update user role", error: error.message });
            }
        });
        // Get all parcels
        app.get('/parcels', async (req, res) => {
            try {
                const userEmail = req.query.email;
                const query = userEmail ? { created_by: userEmail } : {};
                const options = {
                    sort: { createdAt: -1 },
                }
                const parcels = await parcelsCollection.find(query, options).toArray();
                res.status(200).send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to fetch parcels' });
            }
        });
        // get percel info by id
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const parcel = await parcelsCollection.findOne(query);
                res.status(200).send(parcel);
            } catch (error) {
                console.error('Error fetching parcel by ID:', error);
                res.status(500).send({ message: 'Failed to fetch parcel' });
            }
        });
        // Create a new PaymentIntents
        app.post("/create-payment-intent", async (req, res) => {
            try {
                const { amount } = req.body; // amount in cents

                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: "usd",
                    automatic_payment_methods: { enabled: true },
                });

                res.send({
                    clientSecret: paymentIntent.client_secret,
                });
            } catch (error) {
                res.status(500).send({ error: error.message });
            }
        });
        // create paymemt histiory and update parcel
        app.post('/payments', async (req, res) => {
            try {
                const payment = req.body;
                const id = payment.parcelId;

                // Update parcel status
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        payment_status: 'paid',
                        transactionId: payment.transactionId,
                    }
                };
                const parcelUpdateResult = await parcelsCollection.updateOne(filter, updatedDoc);

                // Save payment info with createdAt timestamp
                const paymentRecord = { ...payment, createdAt: new Date() };
                const paymentInsertResult = await paymentsCollection.insertOne(paymentRecord);

                // Respond once with relevant info
                res.status(201).send({
                    message: 'Payment processed successfully',
                    parcelUpdateResult,
                    paymentInsertResult
                });

            } catch (error) {
                console.error('Error processing payment:', error);
                res.status(500).send({ message: 'Failed to process payment' });
            }
        });

        // get payment history
        app.get('/payments', async (req, res) => {
            try {
                const userEmail = req.query.email;
                const query = userEmail ? { email: userEmail } : {};
                const options = {
                    sort: { createdAt: -1 },
                }
                const payments = await paymentsCollection.find(query, options).toArray();
                res.status(200).send(payments);
            } catch (error) {
                console.error('Error fetching payments:', error);
                res.status(500).send({ message: 'Failed to fetch payments' });
            }
        });

        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;
                // newParcel.createdAt = new Date();
                const result = await parcelsCollection.insertOne(newParcel);
                res.status(201).send(result);
            } catch (error) {
                console.error('Error inserting parcel:', error);
                res.status(500).send({ message: 'Failed to create parcel' });
            }
        });
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await parcelsCollection.deleteOne(query);
                res.status(200).send(result);
            }
            catch (error) {
                console.error('Error deleting parcel:', error);
                res.status(500).send({ message: 'Failed to delete parcel' });
            }
        });
        // become a rider api
        app.post('/riders', async (req, res) => {
            try {
                const riderInfo = req.body;
                const result = await ridersCollection.insertOne(riderInfo);
                res.status(201).send(result);
            } catch (error) {
                console.error('Error inserting rider info:', error);
                res.status(500).send({ message: 'Failed to submit rider info' });
            }
        });
        // get all rider data
        app.get('/riders', async (req, res) => {
            try {
                const riders = await ridersCollection.find().toArray();
                res.status(200).send(riders);
            } catch (error) {
                console.error('Error fetching riders:', error);
                res.status(500).send({ message: 'Failed to fetch riders' });
            }
        });
        // get pendin rider data
        app.get('/riders/pending', async (req, res) => {
            try {
                const query = { status: 'pending' };
                const riders = await ridersCollection.find(query).toArray();
                res.status(200).send(riders);
            } catch (error) {
                console.error('Error fetching pending riders:', error);
                res.status(500).send({ message: 'Failed to fetch pending riders' });
            }
        });
        // update rider status
        app.patch('/riders/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const { status } = req.body;
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: { status }
                };
                const userDoc = {
                    $set: { role: 'rider' }
                };
                const result = await ridersCollection.updateOne(filter, updatedDoc);
                res.status(200).send(result);
                const user = await usersCollection.findOne({ email: req.body.email });

                const rider = await usersCollection.updateOne(user, userDoc);
                res.status(200).send(rider);


            } catch (error) {
                console.error('Error updating rider status:', error);
                res.status(500).send({ message: 'Failed to update rider status' });
            }
        });
        // get approved riders
        app.get('/riders/approved', async (req, res) => {
            try {
                const query = { status: 'approved' };
                const riders = await ridersCollection.find(query).toArray();
                res.status(200).send(riders);
            }
            catch (error) {
                console.error('Error fetching approved riders:', error);
                res.status(500).send({ message: 'Failed to fetch approved riders' });
            }
        });
        // rider suspended
        app.patch('/riders/suspend/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: { status: 'suspended' }
                };
                const userDoc = {
                    $set: { role: 'user' }
                };
                const result = await ridersCollection.updateOne(filter, updatedDoc);
                res.status(200).send(result);
                const user = await usersCollection.findOne({ email: req.body.email });

                const rider = await usersCollection.updateOne(user, userDoc);
                res.status(200).send(rider);
            } catch (error) {
                console.error('Error suspending rider:', error);
                res.status(500).send({ message: 'Failed to suspend rider' });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    catch (error) {
        console.error("MongoDB connection error:", error);
    }
}
run().catch(console.dir);

app.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});