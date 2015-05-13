var JSX = require('node-jsx').install(),
  React = require('react');
  
module.exports = {

  index: function(req, res) { 
      if ( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(req.headers['user-agent']) ) { 
        res.render('mhome',{layout: false}); 
      } else {
        res.render('home',{layout: false});
      }
  },
  geo: function(req, res) {
      var ref = req.query.ref == false ? undefined : req.query.ref;
      res.render('geo', {
        ref : ref // Pass ref to identify caller and module
      });
  }

};