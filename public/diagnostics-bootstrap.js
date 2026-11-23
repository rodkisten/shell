/* global window */
// Install before React and before any application module executes.
(function () {
  var events = [];
  var listeners = [];
  var MAX = 150;
  function capture(type, message, detail) {
    var entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2), type: type, message: String(message || 'Unknown error'), detail: String(detail || ''), timestamp: new Date().toISOString(), url: window.location.href };
    events.push(entry);
    if (events.length > MAX) events.shift();
    listeners.slice().forEach(function (listener) { try { listener(entry); } catch (error) { window.console.warn('Diagnostic listener failed', error); } });
  }
  window.__shellDiagnostics = {
    events: events,
    capture: capture,
    subscribe: function (listener) {
      listeners.push(listener);
      return function () { var index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); };
    },
    clear: function () { events.splice(0, events.length); capture('system', 'Diagnostic history cleared'); }
  };
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && target.tagName) {
      capture('resource', 'Failed to load ' + target.tagName, target.src || target.href || '');
    } else {
      capture('error', event.message || 'Uncaught browser error', (event.error && event.error.stack) || (event.filename + ':' + event.lineno + ':' + event.colno));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    capture('promise', (reason && reason.message) || String(reason), (reason && reason.stack) || '');
  });
  window.addEventListener('securitypolicyviolation', function (event) {
    capture('csp', event.violatedDirective, event.blockedURI || '');
  });
  window.addEventListener('messageerror', function () { capture('message', 'Window message could not be deserialized'); });
  window.addEventListener('offline', function () { capture('network', 'Browser went offline'); });
})();
