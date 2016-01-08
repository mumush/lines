var express = require('express');
var app = express();

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cookieParser());

var mongoose = require('mongoose');
var config = require('./../../config');

var port = process.env.PORT || 8080;
mongoose.connect(config.database);
app.set('tokenSecret', config.tokenSecret);

var path = require('path');

app.use(express.static(path.join(__dirname, '../client')));
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');


// ******* Require ROUTES *******
require('./routes')(app);

// Initialize SocketIO
var io = require('socket.io').listen(app.listen(port));
console.log('The magic happens at http://localhost:' + port);

// ******* Require EVENTS *******
require('./events')(io, config.maxGameMoves);
