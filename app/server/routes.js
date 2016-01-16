var bcrypt = require('bcrypt');
var SALT = bcrypt.genSaltSync(10);
var jsonWebToken = require('jsonwebtoken');
var User = require('./models/user');

module.exports = function(app) {

// ******* App Routes *******

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

   res.render( 'base', {title: 'Home', partial: 'index', data: null } );

});

app.get('/logout', function(req, res) {

   // Clear the token, username, and the gameID cookie if it exists (as a precaution)
   res.clearCookie('linesApp');
   res.clearCookie('linesAppUser');
   res.clearCookie('linesAppGame');

   res.redirect('/login');

});

// Middleware Function

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

}; // End module.exports
