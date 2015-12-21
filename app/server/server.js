var express = require('express');
var app = express();

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cookieParser());

var bcrypt = require('bcrypt');
var SALT = bcrypt.genSaltSync(10);

var jsonWebToken = require('jsonwebtoken');

var mongoose = require('mongoose');
var config = require('./../../config');
var User = require('./models/user');
var Game = require('./models/game');

var port = process.env.PORT || 8080;
mongoose.connect(config.database);
app.set('tokenSecret', config.tokenSecret);

var path = require('path');

app.use(express.static(path.join(__dirname, '../client')));
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');


// **** Route Middleware - Checks token before hitting any route ****

function authenticate(req, res, next) {

   var token = req.cookies.linesApp;

   console.log('Token: ' + token);

   if (token) { //If the token exists

      console.log('Token Exists');

      // Verify token and check expiration
      jsonWebToken.verify(token, app.get('tokenSecret'), function(err, decoded) {
         if (err) { // Couldn't verify the token
            console.log('Error, could not verify token.');
            var errorMsg = "Sorry, your token is invalid.";
            res.render( 'base', {title: 'Login', partial: 'login', data: {error: errorMsg}  } );
         }
         else {  // Token is good, set it to a variable to be accessed 'req' in the next route
            req.decoded = decoded;
            console.log('Token is valid: ' + decoded);

            if( req.path == '/login' || req.path == '/signup' ) { // If they're going to the login route, redirect them home
               res.redirect('/');
            }
            else { // If they're hitting any other route, take them there
               next();
            }

         }
      });

   }
   else { // Token doesn't exist

      if( req.path == '/login' || req.path == '/signup' ) { // If they're going to the login route, let them through
         next();
      }
      else {
         res.redirect('/login');
      }

   }

}

// ******* Start App Routes *******

app.get('/signup', authenticate, function(req, res) {
   res.render( 'base', {title: 'Signup', partial: 'signup', data: {error: ""} } );
});

app.post('/signup', function(req, res) {

   // Remove special characters
   var escapedUsername = ((req.body.username).replace(/[^\w\s]/gi, '')).trim();
   var escapedPass = ((req.body.password).replace(/[^\w\s]/gi, '')).trim();

   User.findOne( {username: escapedUsername}, function(err, user) {

      if(err) { // Error occurred
         console.log('User find error occurred.');
         var errorMsg = "We're sorry.  A database error occurred. Please try again.";
         res.render( 'base', {title: 'Signup', partial: 'signup', data: {error: errorMsg} } );
      }

      else if(!user) { // There isn't a user with this username

         console.log('Username not taken...Creating user.');

         // Hash the password via bcrypt
         var passwordHash = bcrypt.hashSync(escapedPass, SALT);

         var newUser = new User({
            username: escapedUsername,
            password: passwordHash
         });

         // Save the new user
         newUser.save(function(err, user) {
            if(err){
               console.log("Error Creating User");
               var errorMsg = "We're sorry. A database error occurred. Please try again.";
               res.render( 'base', {title: 'Signup', partial: 'signup', data: {error: errorMsg} } );
            }
            else {
               console.log('New user saved successfully: ' + user);

               var token = jsonWebToken.sign(user, app.get('tokenSecret'), { // Get value of app setting variable named 'tokenSecret' above
                  expiresIn: 86400 // Expires in 24 hours
               });

               res.cookie('linesApp', token);
               res.cookie('linesAppUser', user.username);
               res.redirect('/');

            }
         });

      }

      else { // User exists -> username is taken
         console.log('User already exists with this username.');
         var error = "Unfortunately that username is already taken.";
         res.render( 'base', {title: 'Signup', partial: 'signup', data: {error: error} } );
      }

   });

});

app.get('/login', authenticate, function(req, res) {
   res.render( 'base', {title: 'Login', partial: 'login', data: {error: ""}  } );
});

app.post('/login', authenticate, function(req, res) {

   // Remove special characters
   var escapedUsername = ((req.body.username).replace(/[^\w\s]/gi, '')).trim();
   var escapedPass = ((req.body.password).replace(/[^\w\s]/gi, '')).trim();

   var errorMsg = "";

   User.findOne( {username: escapedUsername}, function(err, user) {

      if(err) { // Error occurred
         console.log('User find error occurred.');
         errorMsg = "We're sorry.  A database error occurred. Please try again.";
         res.render( 'base', {title: 'Login', partial: 'login', data: {error: errorMsg}  } );
      }

      else if (!user) { // User doesn't exist
         console.log('User does not exist.');
         errorMsg = "Incorrect username or password."; // Don't tell them the user doesn't exist
         res.render( 'base', {title: 'Login', partial: 'login', data: {error: errorMsg}  } );
      }

      else { // User exists

         if (!bcrypt.compareSync(escapedPass, user.password)) { // Password doesn't match
            console.log('Password does not match username.');
            errorMsg = "The username or password is incorrect.";
            res.render( 'base', {title: 'Login', partial: 'login', data: {error: errorMsg}  } );
         }
         else if(user.isOnline) { // This user is already online somewhere else, don't let someone else login again (new socket)
            console.log('User is already online.');
            errorMsg = "Sorry, this user is already logged in.";
            res.render( 'base', {title: 'Login', partial: 'login', data: {error: errorMsg}  } );
         }
         else { // Password is correct, and they're not already online (trying to login from multiple windows/tabs)

            var token = jsonWebToken.sign(user, app.get('tokenSecret'), { // Get value of app setting variable named 'tokenSecret' above
               expiresIn: 86400 // Expires in 24 hours
            });

            res.cookie('linesApp', token);
            res.cookie('linesAppUser', user.username);
            res.redirect('/');

            console.log('Logged in user, redirecting to home.');

         }
      }

   });

});

app.get('/', authenticate, function(req, res) {
   User.find({ username: { $ne: req.cookies.linesAppUser }, isOnline: true }, '-_id username', function(err, users) { // isOnline: true

      if(err) { // Error occurred
         console.log('Error retrieving all users.');
      }
      else {
         res.render( 'base', {title: 'Home', partial: 'index', data: {users: users} } );
      }
   });
});

// ******* End App Routes *******





// ******* Initialize Socket IO *******

var io = require('socket.io').listen(app.listen(port));
console.log('The magic happens at http://localhost:' + port);

// ******* Start Socket IO Events *******

io.on('connection', function(socket) {

   console.log('A user connected.');

   // GO ONLINE EVENT
   socket.on('go online', function(data) {

      User.findOne( {username: data.username}, function(err, user) {

         if(!err && user) { // No error occurred and the user exists
            user.isOnline = true;
            user.socketID = socket.id; // store the connected socket id so we can use it later when user disconnects
            user.save(function(err) {
               if(err) {
                  return;
               }
               socket.broadcast.emit('user online', data.username);
               console.log(data.username + ' is online.');
            });
         }

      });

   });


   // SEND CHAT MESSAGE EVENT -> client sent a message, emit to all sockets
   socket.on('send chat message', function(data) {
      console.log(data.sender + ' says: ' + data.body);
      // Remove special characters
      var escapedSender = ((data.sender).replace(/[^\w\s]/gi, '')).trim();
      var escapedBody = ((data.body).replace(/[^\w\s,'-.?!]/gi, '')).trim(); // Here allow punctuation

      io.emit('new chat message', {sender: escapedSender, body: escapedBody});

   });


   // CHALLENGE REQUEST EVENT
   socket.on('challenge request', function(data) {
      console.log(data.sender + ' requests to challenge ' + data.opponent);

      // Make sure both users are online, and not in games
      User.find( { $or:[{'username': data.sender}, {'username': data.opponent}] }, function(err, users) {

         // No error occurred and we found both users
         if( !err && users.length == 2 ) {
            console.log('Both users exist.');
            // Make sure both users are online, and not in games already
            if( (users[0].isOnline === true && users[1].isOnline === true) && (users[0].inGame === false && users[1].inGame === false) ) {
               console.log('Both users are online and not in games.');

               // Mark both as being in a game (they're not really in a game yet)
               users[0].inGame = true;
               users[1].inGame = true;

               users[0].save(function(err) {
                  if(!err) {
                     console.log('First user saved as in game.');
                     users[1].save(function(err) {
                        if(!err) {
                           console.log('Second user saved as in game.');
                           // Now tell all users that there is a new challenge request in place so we can remove
                           // the challenge button from these users on the front-end
                           io.emit('pending challenge', {users: [data.sender, data.opponent]});

                           // Find the opponents socket id, and then emit the challenge to them
                           var opponentSocket;

                           if( users[0].username ==  data.opponent) {
                              opponentSocket = users[0].socketID;
                              console.log('Sending Challenge To: ' + users[0].username + ' @ ' + users[0].socketID);
                              socket.broadcast.to(opponentSocket).emit('challenge user', data.sender);
                           }
                           else {
                              opponentSocket = users[1].socketID;
                              console.log('Sending Challenge To: ' + users[1].username + ' @ ' + users[1].socketID);
                              socket.broadcast.to(opponentSocket).emit('challenge user', data.sender);
                           }

                        }
                     });
                  }
               });

            }
            else {
               console.log('One or both users is either in a game or offline.');
               // Send back some kind of error here
            }


         }
         else {
            console.log('Error finding users.');
         }

      }); // end DB Find

   }); // end socket event


   // CHALLENGE ACCEPTED EVENT
   socket.on('challenge accepted', function(data) {

      console.log(data.challengee + ' accepted the challenge from ' + data.challenger);

      // Make sure both users are online, and not in games
      User.find( { $or:[{'username': data.challenger}, {'username': data.challengee}] }, function(err, users) {

         // No error occurred and we found both users...Then make sure that both are online
         if( (!err && users.length == 2) && (users[0].isOnline === true && users[1].isOnline === true) ) {

            console.log('Both users found and are online.');

            // Create a new game with the supplied usernames and initialize their scores to 0
            var newGame = new Game({
               challenger: {username: data.challenger, score: 0},
               challengee: {username: data.challengee, score: 0}
            });

            // Save the new user
            newGame.save(function(err, game) {

               if(!err) { // If there wasn't an error creating the game in the back, emit to both users that we can initialize the game

                  console.log("Created new game with ID: " + game._id);

                  // Make a separate game room (different socket namespace)
                  var gameRoomName = game.challenger.username + " " + game.challengee.username;

                  console.log('Creating Room Named: ' + gameRoomName);

                  // Join both sockets to the new room by their retrieved id's
                  io.sockets.connected[users[0].socketID].join(gameRoomName);
                  io.sockets.connected[users[1].socketID].join(gameRoomName);

                  users[0].inGameRoom = gameRoomName;
                  users[0].inGameAgainst = users[1].username;
                  users[1].inGameRoom = gameRoomName;
                  users[1].inGameAgainst = users[0].username;

                  users[0].save(function(err) {
                     if(!err) {
                        users[1].save(function(err) {
                           if(!err) {
                              console.log('Both users saved successfully.');
                           }
                        });
                     }
                  });

                  // Emit the message only to the new socket room
                  io.to(gameRoomName).emit('initialize game', {gameID: game._id, gameRoom: gameRoomName, firstTurn: users[0].username, players: [users[0].username, users[1].username]});

               }

            });

         }

      });

   });

   // CHALLENGE REJECTED EVENT
   socket.on('challenge rejected', function(data) {

      console.log(data.challengee + ' rejected the challenge from ' + data.challenger);

      // Set both users inGame status back to false
      // Make sure both users are online, and not in games
      User.find( { $or:[{'username': data.challenger}, {'username': data.challengee}] }, function(err, users) {

         // No error occurred and we found both users
         if( (!err && users.length == 2) ) {
            console.log('Found both users.');

            users[0].inGame = false;
            users[1].inGame = false;

            users[0].save(function(err) {
               if(!err) {
                  console.log('Saved first user as no longer in game.');
                  users[1].save(function(err) {
                     if(!err) {
                        console.log('Saved second user as no longer in game.');
                        io.emit('pending challenge rejected', {users: [data.challenger, data.challengee]});
                     }
                  });
               }

            });
         }
         else {
            console.log('Unable to find users.');
         }
      });

   });

   // START GAME EVENT
   socket.on('start game', function() {

      console.log('Preparing to start game...');

      // Emit only to the sending user -> CONSIDER sending this inside of the room
      socket.emit('my turn', {opponentsMove: null});

   });


   // CHECK MOVE EVENT
   socket.on('check move', function(move) {

      console.log('Move made by: ' + move.mover);
      console.log('Check move for game: ' + move.gameID);
      console.log('Line Direction: ' + move.line.direction);
      console.log('Line Coords: ' + move.line.x + "," + move.line.y);

      // First check if the gameID passed in from the front-end is in our database (in case someone tampered with their cookie)
      Game.findById(move.gameID, function(err, game) {

         if(err) {
            console.log('Error finding game.');
         }
         else if( game ) { // The game exists - Now check if its 'moves' array has an entry with the supplied coordinates

            console.log('Game Exists: ' + game._id);

            // For loop through the 'moves' array and look for matching moves
            for( var i=0; i<game.moves.length; i++ ) {

               if( game.moves[i].coordinates.x ===  move.line.x && game.moves[i].coordinates.y ===  move.line.y ) {
                  console.log('Same X & Y values');
                  console.log('Invalid move');
                  socket.emit('invalid move');
                  return;
               }

            }

            // If we completed the for loop, we couldn't find any matching moves, so the move is valid
            console.log('Valid move.');

            // Add the move to the database because it's valid
            // In the success callback, check if a square was formed
            // If it was, adjust the game's score for the mover

            game.moves.push({ mover: move.mover, coordinates: {x: move.line.x, y: move.line.y} });

            game.save(function(err) {
               if(err) {
                  console.log('Error saving game.');
                  // Emit a new event like 'Database error' and end the game on both ends
               }
               else {
                  console.log('New move added to game!');

                  // Determine the direction of the move (horizontal and vertical algorithms are slightly different)
                  if( move.line.direction === "H" ) {
                     checkSquareHoriz(game, move.line, move.mover);
                  }
                  else if( move.line.direction === "V" ) {
                     checkSquareVert(game, move.line, move.mover);
                  }
                  else { // Someone tampered with the data, send back an error for invalid move
                     console.log('Error. Invalid move direction.');
                     // socket.emit('invalid move');
                     // ** THIS DOESN'T MAKE SENSE HERE, THE MOVE HAS ALREADY BEEN ADDED.  DO THIS CHECK AT THE START OF THE FUNCTION ***
                  }
               }
            });



         }

         else { // Game with supplied gameID doesn't exist
            console.log('Game with supplied ID does not exist.');
         }


      });


   });


   function checkSquareHoriz(game, line, mover) {

      console.log('Check Square Horiz');

      // The square that can be formed above this line (where this line is the bottom line)
      var upTopLine = { x: line.x, y: (line.y - 2) };
      var upLeftLine = { x: line.x, y: (line.y - 1) };
      var upRightLine = { x: (line.x + 1), y: (line.y - 1) };

      // The square that can be formed below this line (where this line is the top line)
      var downLeftLine = { x: line.x, y: (line.y + 1) };
      var downRightLine = { x: (line.x + 1), y: (line.y + 1) };
      var downBotLine = { x: line.x, y: (line.y + 2) };


      // If either of these come to be 3, we know a square was formed
      var topSquareLineCount = 0;
      var botSquareLineCount = 0;

      for( var i=0; i<game.moves.length; i++ ) {

         // Make sure that this index in the moves array is a move made by the mover, not the opponent
         if( game.moves[i].mover === mover ) {

            console.log('Mover is the same');

            // If a square above this line was formed
            if( (game.moves[i].coordinates.x === upTopLine.x && game.moves[i].coordinates.y === upTopLine.y) || (game.moves[i].coordinates.x === upLeftLine.x && game.moves[i].coordinates.y === upLeftLine.y) || (game.moves[i].coordinates.x === upRightLine.x && game.moves[i].coordinates.y === upRightLine.y) ) {

               topSquareLineCount++;
            }

            // // If a square below this line was formed
            if( (game.moves[i].coordinates.x === downBotLine.x && game.moves[i].coordinates.y === downBotLine.y) || (game.moves[i].coordinates.x === downLeftLine.x && game.moves[i].coordinates.y === downLeftLine.y) || (game.moves[i].coordinates.x === downRightLine.x && game.moves[i].coordinates.y === downRightLine.y) ) {

               botSquareLineCount++;
            }

         }

      }

      console.log('Top and Bot Sum: ' + (topSquareLineCount + botSquareLineCount));
      console.log('Top Sum: ' + topSquareLineCount);
      console.log('Bot Sum: ' + botSquareLineCount);

      var pointsEarned = 0;

      if( topSquareLineCount + botSquareLineCount === 6 ) { // A square was formed above and below this line
         console.log('Square formed above and below line');
         pointsEarned = 2;
      }
      else if( topSquareLineCount === 3 ) {
         console.log('Square formed above line.');
         pointsEarned = 1;
      }
      else if( botSquareLineCount === 3 ) {
         console.log('Square formed below line.');
         pointsEarned = 1;
      }
      else {
         console.log('No square formed.');
         pointsEarned = 0;
      }


      // Don't love the game.save repition here, but because we have to identify whether the mover's username is either the
      // challenger or the challengee, it would require another bool to abstract out the repition, which makes me feel like
      // the code would be more complex than using the same db.save method twice

      if( game.challenger.username === mover ) { // We know the mover is the 'challenger'

         game.challenger.score = game.challenger.score + pointsEarned;

         game.save(function(err) {
            if(err) {
               console.log('Error saving game.');
               // Emit a new event like 'Database error' and end the game on both ends
            }
            else {
               console.log('Score updated!');
               socket.emit('valid move', { line: line, updateScore: {player: game.challenger.username, score: game.challenger.score} });
            }
         });

      }
      else { // They were the user that was challenged to start with: 'challengee'

         game.challengee.score = game.challengee.score + pointsEarned;

         game.save(function(err) {
            if(err) {
               console.log('Error saving game.');
               // Emit a new event like 'Database error' and end the game on both ends
            }
            else {
               console.log('Score updated!');
               socket.emit('valid move', { line: line, updateScore: {player: game.challengee.username, score: game.challengee.score} });
            }
         });

      }


   } // End checkSquareHoriz function


   function checkSquareVert(game, line, mover) {

      console.log('Check Square Vert');

      socket.emit('valid move', { line: line, updateScore: null });

   }


   // DONE TURN EVENT
   socket.on('done turn', function(data) {

      console.log(data.mover + ' is done their turn.');
      console.log('X1 Coordinate ' + data.coordinates.x1);

      // Tell the other user that it's now their turn
      console.log('Broadcasting message to room: ' + data.gameRoom);

      socket.to(data.gameRoom).emit('my turn', {opponentsMove: data.coordinates});

   });


   // DISCONNECT EVENT
   socket.on('disconnect', function() {
      console.log('A user disconnected');

      User.findOne( {socketID: socket.id}, function(err, user) {
         if(!err && user) { // No error occurred and the user exists

            // Tell the opponent that this user left the game, and that they won
            socket.broadcast.to(user.inGameRoom).emit('game over', {winner: user.inGameAgainst});

            User.findOne( {username: user.inGameAgainst}, function(err, opponent) {
               if(!err && opponent) {

                  // Get the socket by its id, and leave the game room
                  var opponentSocket = io.sockets.connected[opponent.socketID];
                  opponentSocket.leave(opponent.inGameRoom);

                  socket.broadcast.emit('user done game', opponent.username);

                  console.log('Clearing out opponent from game...');
                  opponent.inGame = false;
                  opponent.inGameRoom = "";
                  opponent.inGameAgainst = "";

                  // Save opponent
                  opponent.save(function(err) {
                     if(err) {
                        console.log('Error clearing opponnents game data.');
                     }
                     else {
                        console.log('Opponent game data cleared.');
                     }
                  });
               }
            });

            // Remove the user from the game room
            socket.leave(user.inGameRoom);

            // Clean up this user
            user.isOnline = false;
            user.inGame = false;
            user.inGameRoom = "";
            user.inGameAgainst = "";
            user.socketID = ""; // reset to an empty string so we don't have socket.id overlaps with offline users

            user.save(function(err) {
               if(!err) {
                  socket.broadcast.emit('user offline', user.username);
                  console.log(user.username + ' went offline.');
               }
            });
         }

      });

   });

});
