var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var GameSchema = new Schema({
   challenger: {username: String, score: Number}, // User that sent the challenge
   challengee: {username: String, score: Number}, // User that accepted it
   winner: String, // Winner of the game
   moves: [{
      mover: String, // The user that made the move
      coordinates: {x: Number, y: Number}
   }],
   room: String, // The name of the socket room that was created for this game - Ex: 'player5 player23' - in that format
   status: { type: String, default: 0 }, // 0 = pending, 1 = in progress, 2 = done (no more moves or a player disconnect)
});

module.exports = mongoose.model('Game', GameSchema);
