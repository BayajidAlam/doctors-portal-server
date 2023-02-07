const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET)

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@myclaster-1.wxhqp81.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req,res,next){
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send('unauthorized access')
  }

  const token = authHeader.split(' ')[1];
  
  jwt.verify(token,process.env.DB_TOKEN, function(err,decoded){
    if(err){
      return res.status(403).send({message: 'forbidden access'})
    }
    req.decoded = decoded;
    next()
  })
}

async function run(){
  try{
      const appointmentOptionCollection = client.db('dP2').collection('appointmentOprions');
      const bookingCollection = client.db('dP2').collection('booings');
      const usersCollection = client.db('dP2').collection('users');
      const doctorsCollection = client.db('dP2').collection('doctors');

      // verify admin 
      const verifyAdmin =async (req,res,next) =>{
        const decodeEmail = req.decoded.email;
        const query = { email: decodeEmail };
        const user = await usersCollection.findOne(query)
        if(user?.role !== 'admin'){
          return res.status(403).send({message: 'forbidden access'})
        }
        next()
      }

      // get all options 
      app.get('/appointmentOptions',async (req,res)=>{
        const date = req.query.date;
        const query = {}
        const options = await appointmentOptionCollection.find(query).toArray();

        const bookingQuery = { appointmentDate: date }
        const alreadyBooked = await bookingCollection.find(bookingQuery).toArray()
        
        options.forEach(option => {
          const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
          const bookedSlots = optionBooked.map(book => book.slot);
          const remainingSlots = option.slots.filter(slot=> !bookedSlots.includes(slot))
          option.slots = remainingSlots;
        })
        res.send(options)
      })

      app.post('/bookings',async (req,res)=>{
        const booking = req.body;
        const query = { 
              appointmentDate: booking.appointmentDate,
              treatment: booking.treatment
        }

        const alreadyBooked = await bookingCollection.find(query).toArray()
        if(alreadyBooked.length){
          const message = `You already have a booking on ${booking.appointmentDate}`
          return res.send({acknowledged: false,message})
        }

        const result = await bookingCollection.insertOne(booking);
        res.send(result);
      })

      // get one all appointment 
      app.get('/bookings',verifyJWT, async(req,res)=>{
        const email = req.query.email 
        const decodedEmail = req.decoded.email;
        
        if(email !== decodedEmail){
          return res.status(403).send({message: 'unauthorized access'})
        }
        const query = { email: email };
        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings);
      })

      // check weather a user is a admin 
      app.get('/users/admin/:email',async(req,res)=>{
        const email = req.params.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        res.send({ isAdmin: user?.role === 'admin'});
      })

    
      app.get('/appointmentSpecialty', async (req,res)=>{
        const query = {}
        const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
        res.send(result);
      })
      // get all user 
      app.get('/users', async(req,res)=>{
        const query = {};
        const users = await usersCollection.find(query).toArray()
        res.send(users);
      })

      app.put('/users/admin/:id',verifyJWT,verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) }
        const options = { upsert: true };
        const updatedDoc = {
            $set: {
                role: 'admin'
            }
        }
        const result = await usersCollection.updateOne(filter, updatedDoc, options);
        res.send(result);
    });

      // save a user 
      app.post('/users', async(req,res)=>{
        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result)
      })

      // generate token 
      app.get('/jwt', async(req,res)=>{
        const email = req.query.email
        const query = { email : email};
        const user = await usersCollection.findOne(query);
        console.log(user)
        if(user){
          const token = jwt.sign({email},process.env.DB_TOKEN,{expiresIn:'10h'})
          return res.send({accessToken: token})
        }
        res.status(403).send({accessToken:'unauthorized access'})
      })

      // add a doctor 
      app.post('/doctors', async(req,res)=>{
        const doctor = req.body;
        const result = await doctorsCollection.insertOne(doctor)
        res.send(result)
      })

      // get all doctor 
      app.get('/doctors',verifyJWT,verifyAdmin, async(req,res)=>{
        const query = {}
        const result = await doctorsCollection.find(query).toArray();
        res.send(result);
      })

      // delete a doctor 
      app.delete('/doctors/:id', verifyJWT,verifyAdmin,async(req,res)=>{
        const id = req.params.id;

        const query = { _id:new ObjectId(id)}
        const result = await doctorsCollection.deleteOne(query)
        res.send(result);
      })

      app.put('/addPrice', async(req,res)=>{
        const filter = {}
        const options = { upsert: true }
        const updatedDoc = {
          $set: {
            price: 99
          }
        }
        const result = await appointmentOptionCollection.updateMany(filter,updatedDoc,options)
        res.send(result);
      })


      // get a specific booking 
      app.get('/booking/:id', async (req,res)=>{
        const id = req.params.id;
        const query = {_id:new ObjectId(id)}
        const booking = await bookingCollection.findOne(query)
        res.send(booking)
      })

      // stripe api 
      app.post('/create-payment-intent', async(req,res)=>{
        const booking = req.body;
        const price = booking.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
          currency: 'usd',
          amount: amount,
          "payment_method_types":[
            "card"
          ]
        })

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      })

  }
  finally{

  }
}
run()
.catch()

app.listen(port, ()=>{
  console.log(`App is running on port${port}`);
})