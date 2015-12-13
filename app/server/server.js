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
         else { // Password is correct, create the token

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

   // DISCONNECT EVENT
   socket.on('disconnect', function() {
      console.log('A user disconnected');

      User.findOne( {socketID: socket.id}, function(err, user) {

         if(!err && user) { // No error occurred and the user exists
            user.isOnline = false;
            user.socketID = ""; // reset to an empty string so we don't have socket.id overlaps with offline users
            user.save(function(err) {
               if(err) {
                  return;
               }
               socket.broadcast.emit('user offline', user.username);
               console.log(user.username + ' went offline.');
            });
         }

      });

   });

});
