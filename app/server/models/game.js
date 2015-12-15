var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var GameSchema = new Schema({
   challenger: String, // user that sent the challenge
   challengee: String, // user that accepted it
   winner: String,
   moves: [{
      mover: String, // the user that made the move
      coordinates: {x1: String, x2: String, y1: String, y2: String}
   }]
});

module.exports = mongoose.model('Game', GameSchema);
