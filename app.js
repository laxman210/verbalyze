const express = require('express');
const cors = require("cors");
const app = express();
require('dotenv').config(); 


app.use(cors());


app.use(express.json());



const blogRoutes = require('./routes/blogRoutes');
app.use('/api', blogRoutes);


const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
