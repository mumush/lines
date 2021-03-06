var User = require('./models/user');
var Game = require('./models/game');
var Message = require('./models/message');

module.exports = function(io, MAX_GAME_MOVES) {

// ******* Socket IO Events *******

io.on('connection', function(socket) {

   console.log('A user connected.');

   // GO ONLINE EVENT
   socket.on('go online', function(data) {

      User.findOne( {username: data.username}, function(err, user) {

         if(err) {
            console.log('Error finding user.');
            socket.emit('db error');
         }
         else if(user) {

            console.log('Found user.');

            user.isOnline = true; // Mark user as online
            user.socketID = socket.id; // Store the connected socket id so we can use it later when user disconnects

            user.save(function(err) {
               if(err) {
                  console.log('Error saving user.');
                  socket.emit('db error');
               }
               else {

                  // Tell all other users that this user is now online
                  socket.broadcast.emit('user online', user);
                  console.log(data.username + ' is online.');

                  // Find all other users that are online
                  User.find({ username: { $ne: user.username }, isOnline: true }, '-_id username inGame', function(err, users) {

                     if(err) { // Error occurred
                        console.log('Error retrieving all other online users.');
                        socket.emit('db error');
                     }
                     else {

                        // Find the 20 most recent messages and return them
                        var messageQuery = Message.find().sort('timestamp').limit(20);

                        messageQuery.find(function(err, messages) {

                           if(err) { // Error occurred
                              console.log('Error retrieving messages.');
                              socket.emit('db error');
                           }
                           else {
                              // Send this socket all of the online users and the most recent messages
                              socket.emit('now online data', {users: users, messages: messages});
                           }

                        });

                     }

                  }); // End User.find
               }

            }); // End User.save

         }
         else {
            console.log('User does not exist.');
            socket.emit('db error');
         }


      });

   });


   // SEND CHAT MESSAGE EVENT -> client sent a message, emit to all sockets
   socket.on('send chat message', function(data) {
      console.log(data.sender + ' says: ' + data.body);

      // Remove special characters
      var escapedSender = ((data.sender).replace(/[^\w\s]/gi, '')).trim();
      var escapedBody = ((data.body).replace(/[^\w\s,'-.?!]/gi, '')).trim(); // Here allow punctuation

      // Create new Message object to be added to DB
      var newMessage = new Message({
         sender: escapedSender,
         body: escapedBody
      });

      // Save the new message
      newMessage.save(function(err, message) {
         if(err) {
            console.log('Error saving message.');
            socket.emit('db error');
         }
         else {
            console.log('Saved message to database.');

            // Tell all users that there is a new message
            io.emit('new chat message', {sender: message.sender, body: message.body, timestamp: message.timestamp});
         }

      });

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
            if( game.moves.length === MAX_GAME_MOVES  ) {

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

   // Convenience method to return the username of the current user's opponent in a game,
   // based on the game's challenger and challengee usernames
   function getOpponentUsername(username, challengerName, challengeeName) {

      if( challengerName === username ) {
         return challengeeName;
      }
      else {
         return challengerName;
      }

   }

   // REQUEST RESTART GAME EVENT
   socket.on('request restart game', function(data) {

      console.log(data.username + ' requested to restart their game.');

      Game.findById(data.gameID, function(err, game) {

         if(err) {
            console.log('Error finding game.');
         }
         else if(game) {

            console.log('Found game');

            // Find opponent's username in game based on data.username
            var opponentUsername = getOpponentUsername(data.username, game.challenger.username, game.challengee.username);

            // Now find the opponent
            User.findOne( {username: opponentUsername}, function(err, user) {

               if(err) {
                  console.log('Error finding user.');
               }
               else if(user) { // No error occurred and the user exists

                  console.log('Found opponent.  Emitting prompt restart game event to opponents socket');

                  // Emit to the opponent's socket
                  socket.broadcast.to(user.socketID).emit('prompt restart game', data.username);

               }
               else {
                  console.log('User does not exist.');
               }

            });


         }
         else {
            console.log('Game does not exist.');
         }

      });



   });


   // ACCEPT RESTART GAME EVENT
   socket.on('accept restart game', function(data) {

      console.log(data.username + ' accepted request to restart game with ID: ' + data.gameID);

      Game.findById(data.gameID, function(err, game) {

         if(err) {
            console.log('Error finding game.');
         }
         else if(game) {

            console.log('Found game.');

            // Clear all the moves
            game.moves = [];

            // Reset both players' scores
            game.challenger.score = 0;
            game.challengee.score = 0;

            // Save the game
            game.save(function(err) {
               if(err) {
                  console.log('Error saving game.');
               }
               else {

                  console.log('Saved game.');

                  // Tell both players in the game room that they back-end has been reset, and they should update the front
                  io.in(game.room).emit('initiate restart game');

                  // Now tell the player that just accepted the game restart that it's their turn (they get to go first)
                  socket.emit('my turn', {opponentsMove: null});

               }
            });

         }
         else {
            console.log('Game with supplied ID does not exist');
         }

      });

   });


   // REJECT RESTART GAME EVENT
   socket.on('reject restart game', function(data) {

      console.log(data.username + ' rejected the request to restart game: ' + data.gameID);

      // Tell the opponent that their restart request was denied

      Game.findById(data.gameID, function(err, game) {

         if(err) {
            console.log('Error finding game.');
         }
         else if(game) {

            console.log('Found game.');

            // Get the opponent's username
            var opponentUsername = getOpponentUsername(data.username, game.challenger.username, game.challengee.username);

            // Find the opponent and get their socket ID
            User.findOne( {username: opponentUsername}, function(err, opponent) {

               if(err) {
                  console.log('Error finding user.');
                  // Emit error to front-end
               }
               else if(opponent) { // User exists

                  console.log('Found opponent.');

                  // Tell the opponent that their restart request was rejected
                  socket.broadcast.to(opponent.socketID).emit('restart request rejected', opponent.username);

               }
               else {
                  console.log('Opponent does not exist.');
               }

            });

         }
         else {
            console.log('Game with supplied ID does not exist');
         }

      });




   });


   // LEAVE GAME EVENT
   // User intentionally leaves the game
   socket.on('leave game', function(data) {

      console.log('User intentionally left game.');

      // Find user by their socket id
      User.findOne( {socketID: socket.id}, function(err, user) {

         if(err) {
            console.log('Error finding user.');
            // Emit error to front-end
         }
         else if(user) { // No error occurred and the user exists

            console.log('Found user: ' + user.username);

            Game.findById(data.gameID, function(err, game) {

               if(err) {
                  console.log('Error finding game.');
               }
               else if(game) {

                  console.log('Found game');

                  // Find opponents username based on game player's usernames
                  var opponentUsername = getOpponentUsername(user.username, game.challenger.username, game.challengee.username);
                  console.log('Opponent username: ' + opponentUsername);

                  game.winner = opponentUsername;
                  game.status = 2; // The game is now considered 'done'

                  game.save(function(err) {
                     if(err) {
                        console.log('Error saving game.');
                        // Emit a new event like 'Database error' and end the game on both ends
                     }
                     else {

                        console.log('Saved game state.');

                        // Set user to no longer be in game
                        user.inGame = false;

                        user.save(function(err) {
                           if(err) {
                              console.log('Error saving user.');
                           }
                           else {

                              // Tell the opponent that this user left the game, and that they won
                              socket.broadcast.to(game.room).emit('opponent left game', opponentUsername);

                              // Now leave this user from the game socket room
                              socket.leave(game.room);

                              // Find the opponent by their username
                              User.findOne( {username: opponentUsername}, function(err, opponent) {

                                 if(err) {
                                    console.log('Error finding user.');
                                    // Emit error to front-end
                                 }
                                 else if(opponent) { // User exists

                                    console.log('Found opponent.');

                                    // Get the opponent's socket by its id, and leave the game room
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

                                          // Tell all users, including both players, that each player is done a game
                                          io.emit('user done game', user.username);
                                          io.emit('user done game', opponent.username);

                                       }
                                    });

                                 }
                                 else {
                                    console.log('Opponent does not exist.');
                                 }

                              }); // end opponent.find

                           }
                        }); // end user.save


                     }
                  }); // end Game.save

               }
               else {
                  console.log('Game does not exist.');
               }

            }); // end Game.find

         }
         else {
            console.log('User does not exist.');
         }


      }); // end User.find

   });


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

                  // Find opponents username based on game player's usernames
                  var opponentUsername = getOpponentUsername(user.username, game.challenger.username, game.challengee.username);
                  console.log('Opponent username: ' + opponentUsername);

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

                                 // Tell all users that this user is finished their game
                                 io.emit('user done game', opponent.username);

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


}; // End module.exports
