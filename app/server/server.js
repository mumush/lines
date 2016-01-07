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

// Create an app-wide constant for the maximum number of moves per game
app.set('maxGameMoves', config.maxGameMoves);


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
   User.find({ username: { $ne: req.cookies.linesAppUser }, isOnline: true }, '-_id username inGame', function(err, users) { // isOnline: true

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
               socket.broadcast.emit('user online', user);
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

                           // Make a separate socket room (different socket namespace) for the players to communicate in
                           var gameRoomName = data.sender + " " + data.opponent;

                           // Create a new game with the supplied usernames and initialize their scores to 0
                           var newGame = new Game({
                              challenger: {username: data.sender, score: 0},
                              challengee: {username: data.opponent, score: 0},
                              room: gameRoomName,
                              status: 0 // Game state is 'pending' -> this is the default behavior and is written here to be explicit
                           });


                           // Save the new game
                           newGame.save(function(err, game) {

                              if(!err) { // If there wasn't an error creating the game, emit to both users that we can initialize the game

                                 console.log("Created new game with ID: " + game._id);

                                 console.log('Creating Room Named: ' + game.room);

                                 // Join both sockets to the new room by their retrieved id's
                                 io.sockets.connected[users[0].socketID].join(game.room);
                                 io.sockets.connected[users[1].socketID].join(game.room);

                                 // Find the opponents socket id
                                 var opponentSocket;

                                 // Then emit the challenge to ONLY their socket
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

            // Find a game in which the challenger and challengee match what was sent from the front-end
            // And ensure that the game's status is still 0: 'pending'
            Game.findOne({ $and: [ {'challenger.username': data.challenger}, {'challengee.username': data.challengee}, { status: 0 } ] },
            function(err, game) {

               if(err) {
                  console.log('Error finding game.');
               }
               else if( game ) {

                  console.log('Found game with the challenger and challengee that is in progress.');

                  game.status = 1; // Set the game status now to 1 -> 'in progress'

                  game.save(function(err) {
                     if(err) {
                        console.log('Error saving game.');
                        // Emit a new event like 'Database error' and end the game on both ends
                     }
                     else {

                        // CONSIDER making the first turn random rather than always being the challengee

                        // Emit the message only to the new socket room
                        io.to(game.room).emit('initialize game', {gameID: game._id, firstTurn: game.challengee.username, players: [game.challenger.username, game.challengee.username]});

                     }

                  });

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

                        // Find the pending game that was created for these players, and delete it
                        Game.findOne({ $and: [ {'challenger.username': data.challenger}, {'challengee.username': data.challengee}, { status: 0 } ] },
                        function(err, game) {

                           if(err) {
                              console.log('Error finding game.');
                           }
                           else if( game ) {

                              console.log('Found pending game with both players. Deleting game from the DB...');

                              io.emit('pending challenge rejected', {users: [data.challenger, data.challengee]});

                              // Remove the game from the DB
                              game.remove();

                           }

                        });

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

            console.log('Valid move.'); // If we completed the for loop, we couldn't find any matching moves, so the move is valid

            game.moves.push({ mover: move.mover, coordinates: {x: move.line.x, y: move.line.y} });

            game.save(function(err) {
               if(err) {
                  console.log('Error saving game.');
                  // Emit a new event like 'Database error' and end the game on both ends
               }
               else {
                  console.log('New move added to game!');

                  checkSquare(game, move.line, move.mover);
               }
            });

         }

         else { // Game with supplied gameID doesn't exist
            console.log('Game with supplied ID does not exist.');
         }


      });


   });


   function checkSquare(game, line, mover) {

      var firstSquareLineOne;
      var firstSquareLineTwo;
      var firstSquareLineThree;

      var secondSquareLineOne;
      var secondSquareLineTwo;
      var secondSquareLineThree;

      // Check the direction of the line

      if( line.direction === "H" ) { // Use Horizontal algorithm

         console.log('Check Square Horiz');

         // The square that can be formed above this line (where this line is the bottom line)
         firstSquareLineOne = { x: line.x, y: (line.y - 2) };
         firstSquareLineTwo = { x: line.x, y: (line.y - 1) };
         firstSquareLineThree = { x: (line.x + 1), y: (line.y - 1) };

         // The square that can be formed below this line (where this line is the top line)
         secondSquareLineOne = { x: line.x, y: (line.y + 1) };
         secondSquareLineTwo = { x: (line.x + 1), y: (line.y + 1) };
         secondSquareLineThree = { x: line.x, y: (line.y + 2) };

      }
      else if( line.direction === "V" ) { // Use Vertical algorithm

         console.log('Check Square Vert');

         // The square that can be formed to the right of this line
         firstSquareLineOne = { x: line.x, y: (line.y - 1) }; // Up right line
         firstSquareLineTwo = { x: (line.x + 1), y: line.y }; // Right line
         firstSquareLineThree = { x: line.x, y: (line.y + 1) }; // Down right line

         // The square that can be formed to the left of this line
         secondSquareLineOne = { x: (line.x - 1), y: (line.y - 1) }; // Up left line
         secondSquareLineTwo = { x: (line.x - 1), y: line.y }; // Left line
         secondSquareLineThree = { x: (line.x - 1), y: (line.y + 1) }; // Down left line

      }
      else {
         console.log('Invalid line direction');
         // Emit socket error
      }



      // The number of lines already moved to by the 'mover' that could form the first or second possible square
      // If either of these come to be 3, a square was formed
      var firstSquareLineCount = 0;
      var secondSquareLineCount = 0;

      for( var i=0; i<game.moves.length; i++ ) {

         // Make sure that this index in the moves array is a move made by the mover, not the opponent
         if( game.moves[i].mover === mover ) {

            console.log('Mover is the same');

            // If a square above this line was formed
            if( (game.moves[i].coordinates.x === firstSquareLineOne.x && game.moves[i].coordinates.y === firstSquareLineOne.y) || (game.moves[i].coordinates.x === firstSquareLineTwo.x && game.moves[i].coordinates.y === firstSquareLineTwo.y) || (game.moves[i].coordinates.x === firstSquareLineThree.x && game.moves[i].coordinates.y === firstSquareLineThree.y) ) {

               firstSquareLineCount++;
            }

            // // If a square below this line was formed
            if( (game.moves[i].coordinates.x === secondSquareLineOne.x && game.moves[i].coordinates.y === secondSquareLineOne.y) || (game.moves[i].coordinates.x === secondSquareLineTwo.x && game.moves[i].coordinates.y === secondSquareLineTwo.y) || (game.moves[i].coordinates.x === secondSquareLineThree.x && game.moves[i].coordinates.y === secondSquareLineThree.y) ) {

               secondSquareLineCount++;
            }

         }

      } // end for loop


      console.log('First and Second Line Sum: ' + (firstSquareLineCount + secondSquareLineCount));
      console.log('First Sum: ' + firstSquareLineCount);
      console.log('Second Sum: ' + secondSquareLineCount);

      var pointsEarned = 0;

      if( firstSquareLineCount + secondSquareLineCount === 6 ) { // Two squares were formed
         console.log('First & Second squares formed');
         pointsEarned = 2;
      }
      else if( firstSquareLineCount === 3 ) {
         console.log('First square formed');
         pointsEarned = 1;
      }
      else if( secondSquareLineCount === 3 ) {
         console.log('Second square formed.');
         pointsEarned = 1;
      }
      else {
         console.log('No square formed.');

         pointsEarned = 0;

         // If the move didn't form a square, there's no need to hit the database and update the score to be (_the_score + 0)
         // Instead, just emit a valid move, and send null back as the updatedScore so that the front can catch this and doesn't
         // have to make an unneccessary update to the UI...Then return from the entire function so we don't execute the code below
         socket.emit('valid move', { line: line, updateScore: null });
         return;

      }


      // I don't love the game.save() repition here, but because we have to identify whether the mover's username is either the
      // challenger or the challengee in the db, it would require another bool/check to abstract out the repition, which makes me feel like
      // the code would be more complex than using the same db.save method twice and changing one line

      if( game.challenger.username === mover ) { // If true, we know the mover is the 'challenger'

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
      else { // They are the user that was challenged to start with: 'challengee'

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


   } // end checkSquare() function



   // DONE TURN EVENT
   socket.on('done turn', function(data) {

      console.log('x: ' + data.line.x + ' y: ' + data.line.y);

      Game.findById(data.gameID, function(err, game) {

         if(err) {
            console.log('Error finding game.');
         }
         else if(game) {

            // It's the last move of the game
            if( game.moves.length === app.get('maxGameMoves')  ) {

               console.log('Last move of the game. Telling both players the game is over.');

               // First tell the opponent that it's their turn, so we can update their UI from the last move
               socket.to(game.room).emit('my turn', {opponentsMove: data.line, opponentsScore: data.updatedScore});

               // Find the winner of the game given the scores
               var gameWinner = findGameWinner(game.challenger, game.challengee);
               console.log('The winner is: ' + gameWinner);

               // Add the winner's username to the 'winner' field in the DB
               game.winner = gameWinner; // Reminder: this will be null if the game was a tie

               game.status = 2; // The game is now considered 'done' as there are no more possible moves

               game.save(function(err) {

                  if(err) {
                     console.log('Error saving game.');
                     // Emit a new event like 'Database error' and end the game on both ends
                  }
                  else {

                     console.log('Stored the winner in the game.');

                     // Tell both players that the game is over, and who won
                     io.in(game.room).emit('game over', gameWinner);

                     // Set 'inGame' field of both players to 'false', and remove them from their game socket's room
                     removePlayersFromGame(game);

                  }
               });


            }
            // A standard move that isn't the last
            else {

               // Tell the other user that it's now their turn
               console.log('Broadcasting message to room: ' + game.room);

               socket.to(game.room).emit('my turn', {opponentsMove: data.line, opponentsScore: data.updatedScore});

            }

         }
      });

   });


   // Remove both players from the game in the DB
   // Disconnect both players from the game's socket room
   function removePlayersFromGame(game) {

      // Make sure both users are online, and not in games
      User.find( { $or:[{'username': game.challenger.username}, {'username': game.challengee.username}] }, function(err, users) {

         if(err) {
            console.log('Error finding users.');
            // Emit socket error
         }
         else if( users.length == 2 ) { // No error occurred and we found both users

            // Set both users as no longer in games

            users[0].inGame = false;
            users[1].inGame = false;

            users[0].save(function(err) {

               if(err) {
                  console.log('Error saving user.');
                  // Emit error to front-end
               }
               else {

                  console.log('First player no longer in game.  Removing from socket room: ' + game.room);

                  // Get the first user's socket by its id, and leave the game room
                  var user0Socket = io.sockets.connected[users[0].socketID];
                  user0Socket.leave(game.room);

                  // Tell all users that this user is finished their game
                  io.emit('user done game', users[0].username);

                  users[1].save(function(err) {
                     if(err) {
                        console.log('Error saving user.');
                        // Emit error to front-end
                     }
                     else {

                        console.log('Second player no longer in game.  Removing from socket room: ' + game.room);

                        // Get the second user's socket by its id, and leave the game room
                        var user1Socket = io.sockets.connected[users[1].socketID];
                        user1Socket.leave(game.room);

                        // Tell all other users that this user is finished their game
                        io.emit('user done game', users[1].username);

                     }
                  });

               }

            });
         }
         else {
            console.log('Could not find both users.');
            // Emit error
         }

      });

   }

   // Returns the username of the game winner
   function findGameWinner(challenger, challengee) {

      var winner;

      if( challenger.score > challengee.score ) { // Challenger won
         winner = challenger.username;
      }
      else if( challenger.score < challengee.score ) { // Challengee won
         winner = challengee.username;
      }
      else { // Tie game
         winner = null;
      }

      return winner;

   }


   // Convenience method for when a user (socket) disconnects
   // gameRoom = null when the user was not in a game during the disconnect
   // gameRoom != null when the user was in a game
   function disconnectUser(socket, user, gameRoom) {

      if(gameRoom !== null) { // The user was in a game, remove them from the game socket room
         socket.leave(gameRoom);
      }

      // Reset state of user
      user.isOnline = false;
      user.inGame = false;
      user.socketID = ""; // Reset to an empty string so we don't have socket.id overlaps with offline users

      user.save(function(err) {
         if(err) {
            console.log('Error saving user.');
            // Emit error to front-end
         }
         else {
            socket.broadcast.emit('user offline', user.username);
            console.log(user.username + ' went offline.');
         }
      });

   }


   // DISCONNECT EVENT
   socket.on('disconnect', function() {

      console.log('A user disconnected');

      User.findOne( {socketID: socket.id}, function(err, user) {

         if(err) {
            console.log('Error finding user.');
            // Emit error to front-end
         }
         else if(user) { // No error occurred and the user exists

            // Find a game where one of the players is the user that disconnected, and that is either in
            // a pending or in progress state
            Game.findOne({ $and: [
               { $or: [ {'challenger.username': user.username}, {'challengee.username': user.username}] },
               { $or: [ {status: 0}, {status: 1}] } // game is pending or in progress
            ]},
            function(err, game) {

               if(err) {
                  console.log('Error finding game.');
               }
               else if( game ) {

                  console.log('Found game with this user that is pending or still in progress.');

                  // The user was in a game that isn't complete, disconnect them from the game socket and then clean up their state
                  disconnectUser(socket, user, game.room);

                  // Need this so we can reset the opponents 'inGame' state
                  var opponentUsername;

                  // Figure out if the user that disconnected (this user) is the game's challenger or challengee
                  // Set the winner of the game to the opponent's username
                  // Tell the other user (opponent) that this user left the game, and that they won
                  if( game.challenger.username === user.username ) {
                     opponentUsername = game.challengee.username;
                  }
                  else {
                     opponentUsername = game.challenger.username;
                  }


                  if( game.status === 0 ) { // game is pending (challenge request not yet accepted or rejected)

                     console.log('Game is pending.');

                     // Find the opponent in the DB, so that we can set their 'inGame' state to false
                     User.findOne( {username: opponentUsername}, function(err, opponent) {

                        if(err) {
                           console.log('Error finding user.');
                           // Emit error to front-end
                        }
                        else if(opponent) { // User exists

                           console.log('Found opponent: ' + opponent.username);

                           // Get the socket by its id, and leave the game room
                           var opponentSocket = io.sockets.connected[opponent.socketID];
                           opponentSocket.leave(game.room);

                           console.log('Setting opponent as no longer in game...');
                           opponent.inGame = false;

                           // Save opponent user's state
                           opponent.save(function(err) {
                              if(err) {
                                 console.log('Error saving opponents in game state.');
                              }
                              else {

                                 console.log('Opponent in game state updated.');

                                 console.log('Telling front-end that a challenge was rejected due to disconnect.');
                                 io.emit('pending challenge rejected', {users: [game.challenger.username, game.challengee.username]});

                                 console.log('Deleting game from DB...');
                                 // Remove the game from the DB
                                 game.remove();

                              }
                           });

                        }
                        else {
                           console.log('User does not exist.');
                           // Emit error
                        }

                     });

                  }
                  else { // 1 = game in progress

                     console.log('Game is curently in progress.');

                     game.winner = opponentUsername;
                     io.in(game.room).emit('opponent left game', opponentUsername);

                     game.status = 2; // The game is now considered 'done'

                     game.save(function(err) {
                        if(err) {
                           console.log('Error saving game.');
                           // Emit a new event like 'Database error' and end the game on both ends
                        }
                        else {
                           console.log('Stored the winner in the game.');

                           // Find the opponent in the DB, so that we can set their 'inGame' state to false
                           User.findOne( {username: opponentUsername}, function(err, opponent) {

                              if(err) {
                                 console.log('Error finding user.');
                                 // Emit error to front-end
                              }
                              else if(opponent) { // User exists

                                 console.log('Found opponent: ' + opponent.username);

                                 // Get the socket by its id, and leave the game room
                                 var opponentSocket = io.sockets.connected[opponent.socketID];
                                 opponentSocket.leave(game.room);

                                 socket.broadcast.emit('user done game', opponent.username);

                                 console.log('Setting opponent as no longer in game...');
                                 opponent.inGame = false;

                                 // Save opponent user's state
                                 opponent.save(function(err) {
                                    if(err) {
                                       console.log('Error saving opponents in game state.');
                                    }
                                    else {
                                       console.log('Opponent in game state updated.');
                                    }
                                 });

                              }
                              else {
                                 console.log('User does not exist.');
                                 // Emit error
                              }

                           });

                        }
                     });


                  }

               }
               else { // Couldn't find a game

                  console.log('Could not find a game with this user that is pending or in progress.');

                  // This user's connection to the socket is terminated, clean up their state
                  disconnectUser(socket, user, null);
               }

            });

         }
         else {
            console.log('User does not exist.');
            // Emit error to front-end
         }

      });

   }); // END DISCONNECT EVENT

});
