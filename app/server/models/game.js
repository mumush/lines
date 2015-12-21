var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// var GameSchema = new Schema({
//    challenger: String, // User that sent the challenge
//    challengee: String, // User that accepted it
//    winner: String, // Winner of the game
//    moves: [{
//       mover: String, // The user that made the move
//       coordinates: {x: Number, y: Number}
//    }]
// });

var GameSchema = new Schema({
   challenger: {username: String, score: Number}, // User that sent the challenge
   challengee: {username: String, score: Number}, // User that accepted it
   winner: String, // Winner of the game
   moves: [{
      mover: String, // The user that made the move
      coordinates: {x: Number, y: Number}
   }]
});

module.exports = mongoose.model('Game', GameSchema);
