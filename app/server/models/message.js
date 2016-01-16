var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var MessageSchema = new Schema({
   sender: String, // Username of sender
   body: String, // Content of message
   timestamp: { type: Date, default: Date.now } // Date-time of message
});

module.exports = mongoose.model('Message', MessageSchema);
