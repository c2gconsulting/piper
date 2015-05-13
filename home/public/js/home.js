var inputReady = true;
var input = $('.token-input');
input.focus();
$('.container').on('click', function(e) {
  input.focus();
});

input.on('keyup', function(e) {
  $('.new-output').text(input.val());
});

$('.transparent').on('submit', function(e) {
  e.preventDefault();
  var val = $(this).children($('.token-input')).val();
  if (val && val != '') {
    if (invalidToken(val)) {
      $('.new-output').removeClass('new-output');
      resetForm('The token you provided is invalid. Please copy the correct one carefully and try again');
    } else {
      $('.new-output').removeClass('new-output');
      var msg = 'Connecting to Slack...';
      $('.topcontainer').append('<p class="prompt">' + msg + '</p>');
    
      var xmlhttp;
      if (window.XMLHttpRequest) { // code for IE7+, Firefox, Chrome, Opera, Safari
        xmlhttp = new XMLHttpRequest();
      } else { // code for IE6, IE5
        xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
      }
      xmlhttp.onreadystatechange = function() {
          if (xmlhttp.readyState==4 && xmlhttp.responseText) {
            try {
              resp = JSON.parse(xmlhttp.responseText);
            } catch(e) {
              resp = { 'ok': false };
            }
            if (resp.ok) {
              $('.prompt').removeClass('prompt');
              var m1 = 'Connected! Attaching myself to ' + resp.name + '\'s account as @' + resp.bot + '......................';
              var m2 = 'Housekeeping and other very important stuff......................................';
              var m3 = 'Congratulations, you\'re all set! The administrator for your account is ' + resp.email;
              var m4 = 'Redirecting to Slack...';
              $('.topcontainer').append('<p class="prompt">' + m1 + '</p>');
              setTimeout(function() { $('.prompt').removeClass('prompt'); $('.topcontainer').append('<p class="prompt">' + m2 + '</p>'); }, 3000);
              setTimeout(function() { $('.prompt').removeClass('prompt'); $('.topcontainer').append('<p class="prompt">' + m3 + '</p>'); }, 5000);
              setTimeout(function() { $('.prompt').removeClass('prompt'); $('.topcontainer').append('<p class="prompt">' + m4 + '</p>'); }, 8000);
              setTimeout(function() { window.location.href = 'http://' + resp.domain + '.slack.com/messages/@' + resp.bot; }, 12000)
            } else {
              var resp = JSON.parse(xmlhttp.responseText);
              switch (resp.error) {
                case 'existing_client':
                  var msg = resp.name + ' is already registered. Redirecting to Slack...';
                  $('.prompt').removeClass('prompt');
                  $('.topcontainer').append('<p class="prompt">' + msg + '</p>');
                  setTimeout(function() { window.location.href = 'http://' + resp.domain + '.slack.com/messages/@' + resp.bot; }, 5000);
                  break;
                case 'registration_failure':
                  resetForm('Oops, something went wrong. Please wait a moment then try again'); 
                  break;
                default:
                  resetForm('This token is invalid. Please copy the correct one carefully and try again');
              }
            }
        } else {
           // resetForm('Oops, something went wrong. Please wait a moment then try again'); 
        }
      };
      xmlhttp.open("GET", "api/register?token=" + val, true);
      xmlhttp.send();
    }
  }
});

function invalidToken(token) {
  if (token.length !== 40) return true;
  if (token.substr(0, 3) !== 'xox') return true;
  return false;
}

function resetForm(message) {
  var input = $('.token-input');
  $('.prompt').removeClass('prompt');
            
  input.val('');
  $('.topcontainer').append('<p>' + message + '</p><p class="p1 new-output"></p>');
  $('.new-output').velocity('scroll', { duration: 100 });
}