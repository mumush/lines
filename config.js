module.exports = {
   'maxGameMoves': 8, // The max number of moves in each game (All games are 3x3's for brevity, thus the max move/line count is 24)
   'tokenSecret': 'goodnightsweetprince', // used for the json web token
   'cookieSecret': 'latersonthemenjay',
   'database': 'mongodb://localhost/lines-db'
   // 'database': 'mongodb://mumush:Macwinlin37@ds035573.mongolab.com:35573/lines-db' // Hosted on mongolab.com
};
