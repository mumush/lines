var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var UserSchema = new Schema({ // can get date of creation from id
   username: { type: String, unique: true, required: true },
   password: { type: String, required: true },
   socketID: String,
   isOnline: { type: Boolean, default: false }, // Set to true after logging in
   inGame: { type: Boolean, default: false },
   inGameAgainst: String,
   inGameRoom: String
});

module.exports = mongoose.model('User', UserSchema);
