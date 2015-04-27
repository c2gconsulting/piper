var JSX = require('node-jsx').install(),
  React = require('react');
  
module.exports = {

  index: function(req, res) {
    /* Call static model method to get tweets in the db
    Tweet.getTweets(0,0, function(tweets, pages) {

      // Render React to a string, passing in our fetched tweets
      var markup = React.renderComponentToString(
        TweetsApp({
          tweets: tweets
        })
      );*/

      // Render our 'home' template
      res.render('home', {
        markup: 'YO', // Pass rendered react markup
        state: 'SUP' // Pass current state to client side
      });

    //});
  },

  geo: function(req, res) {
      var ref = req.query.ref == false ? undefined : req.query.ref;
      res.render('geo', {
        ref : ref // Pass ref to identify caller and module
      });

  },

  page: function(req, res) {
    // Fetch tweets by page via param
    //Tweet.getTweets(req.params.page, req.params.skip, function(tweets) {

      // Render as JSON
      //res.send(tweets);

    //});
  }

}