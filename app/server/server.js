var express = require('express');
var app = express();

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cookieParser());

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
            return res.json({ success: false, message: 'Failed to authenticate token.' });
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
   res.render( 'base', {title: 'Signup', partial: 'signup', data: {} } );
});

app.post('/signup', function(req, res) { // ***** SANITIZE DATA *****

   User.findOne( {username: req.body.username}, function(err, user) {

      if(err) { // Error occurred
         console.log('User find error occurred.');
         return res.json({ success: false, message: 'Error querying the database.' });
      }

      else if(!user) { // There isn't a user with this username

         console.log('Username not taken...Creating user.');

         var newUser = new User({
            username: req.body.username,
            password: req.body.password // HASH THIS LATER
         });

         // Save the new user
         newUser.save(function(err, user) {
            if(err){
               console.log("Error Creating User");
               return res.json({ success: false, message: 'Error creating user.' }); // Make this more helpful for the user later
               // throw err;
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
         return res.json({ success: false, message: 'Username is already in use.' });
      }

   });

});

app.get('/login', authenticate, function(req, res) {
   res.render( 'base', {title: 'Login', partial: 'login', data: {} } );
});

app.post('/login', authenticate, function(req, res) {

   User.findOne( {username: req.body.username}, function(err, user) {

      if(err) { // Error occurred
         console.log('User find error occurred.');
         return res.json({ success: false, message: 'Error querying the database.' });
      }

      else if (!user) { // User doesn't exist
         console.log('User does not exist.');
         res.json({ success: false, message: 'Incorrect username or password.' });
      }

      else { // User exists

         if (user.password != req.body.password) { // Password doesn't match
            console.log('Password does not match username.');
            res.json({ success: false, message: 'Incorrect username or password.' });
         }
         else if(user.isOnline) { // This user is already online somewhere else, don't let someone else login again (new socket)
            console.log('User is already online.');
            res.json({ success: false, message: 'User is already logged in.' });
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
         return res.json({ success: false, message: 'Error querying the database.' });
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
      // *** DO VALIDATION HERE ***
      io.emit('new chat message', {sender: data.sender, body: data.body});

   });


   // CHALLENGE REQUEST EVENT
   socket.on('challenge request', function(data) {
      console.log(data.sender + ' requests to challenge ' + data.opponent);

      User.findOne( {username: data.opponent}, function(err, user) {

         if(!err && user) { // No error occurred and the user exists
            var opponentSocket = user.socketID;
            console.log('Sending Challenge To: ' + user.username + ' @ ' + user.socketID);
            socket.broadcast.to(opponentSocket).emit('challenge user', data.sender);
         }

      });

   });


   // CHALLENGE ACCEPTED EVENT
   socket.on('challenge accepted', function(data) {

      console.log(data.challengee + ' accepted the challenge from ' + data.challenger);

      // Make sure both users are online, and not in games
      User.find( { $or:[{'username': data.challenger}, {'username': data.challengee}] }, function(err, users) {

         // No error occurred and we found both users...Then make sure that both are online
         if( (!err && users.length == 2) && (users[0].isOnline === true && users[1].isOnline === true) ) {

            console.log('Both users found and are online.');

            // Create a new game in the
            var newGame = new Game({
               challenger: data.challenger,
               challengee: data.challengee
            });

            // Save the new user
            newGame.save(function(err, game) {

               if(!err) { // If there wasn't an error creating the game in the back, emit to both users that we can initialize the game

                  console.log("Created new game with ID: " + game._id);

                  // Make a separate game room (different socket namespace)
                  var gameRoomName = game.challenger + " " + game.challengee;

                  console.log('Creating Room Named: ' + gameRoomName);

                  // Join both sockets to the new room by their retrieved id's
                  io.sockets.connected[users[0].socketID].join(gameRoomName);
                  io.sockets.connected[users[1].socketID].join(gameRoomName);

                  // Emit the message only to the new socket room
                  io.to(gameRoomName).emit('initialize game', {gameID: game._id, gameRoom: gameRoomName, firstTurn: users[0].username, players: [users[0].username, users[1].username]});

               }

            });

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
      console.log('Check move at: x1: ' + move.x1 + ' x2: ' + move.x2 + ' y1: ' + move.y1 + ' y2: ' + move.y2);

      // Attempt to find a move in the game (via supplied gameID)
      // If it doesn't exist, add it and emit a valid move - If it does, emit an invalid move to the sender
      Game.findOne({ _id: move.gameID, 'moves.coordinates': {x1: move.x1, x2: move.x2, y1: move.y1, y2: move.y2} }, function(err, game) {
         if(err) {
            console.log('Error finding game.');
            // Emit invalid move/socket error
         }
         else if(game === null) { // A move doesn't exist in this game with the supplied coordinates
            console.log('Value of Game.findOne: ' + game);

            Game.findById(move.gameID, function(err, game) {

               if(!err && game) { // No error occurred and we got the game

                  game.moves.push({mover: move.mover, coordinates: {x1: move.x1, x2: move.x2, y1: move.y1, y2: move.y2}});

                  game.save(function(err) {
                     if(err) {
                        console.log('Error saving game.');
                        // Emit invalid move/socket error
                     }
                     else {
                        console.log('New move added to game!');
                        socket.emit('valid move', {coordinates: {x1: move.x1, x2: move.x2, y1: move.y1, y2: move.y2}});
                     }
                  });
               }
               else {
                  console.log('Error finding game.');
                  // Emit invalid move
               }

            });

         }
         else { // A move exists with these coordinates in this game
            console.log('Move already exists in game');
            // Emit invalid move
         }
      });


   });


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
            user.isOnline = false;
            user.socketID = ""; // reset to an empty string so we don't have socket.id overlaps with offline users
            user.save(function(err) {
               if(err) {
                  console.log('Error saving user.');
                  return;
               }
               socket.broadcast.emit('user offline', user.username);
               console.log(user.username + ' went offline.');
            });
         }

      });

   });

});
