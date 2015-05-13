var JSX = require('node-jsx').install(),
  React = require('react');
  
module.exports = {

  index: function(req, res) { 
      res.render('home',{layout: false});

  },
  geo: function(req, res) {
      var ref = req.query.ref == false ? undefined : req.query.ref;
      res.render('geo', {
        ref : ref // Pass ref to identify caller and module
      });
  }

};