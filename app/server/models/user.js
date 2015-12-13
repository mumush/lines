var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var UserSchema = new Schema({ // can get date of creation from id
   username: { type: String, unique: true },
   password: String,
   isOnline: { type: Boolean, default: false }, // WHEN THEY CONNECT TO THE WEB SOCKET
   socketID: String,
   challenges: [{
      oponent_id: Schema.Types.ObjectId,
      time_of_challenge: { type: Date, default: Date.now },
      expiration: Date
   }] // THINK ABOUT ADDING AN 'in_game' BOOLEAN TO SHOW THAT A USER IS ONLINE, BUT CURRENTLY IN A GAME
});

module.exports = mongoose.model('User', UserSchema);
