var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var UserSchema = new Schema({
   username: { type: String, unique: true, required: true },
   password: { type: String, required: true }, // Hashed and salted before inserted
   socketID: String, // Socket Identifier
   isOnline: { type: Boolean, default: false }, // Set to true after logging in
   inGame: { type: Boolean, default: false } // Whether or not the user is in a game
});

module.exports = mongoose.model('User', UserSchema);
