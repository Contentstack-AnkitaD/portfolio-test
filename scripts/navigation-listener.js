// Main navigation listener that combines tracking and messaging
class NavigationListener {
  constructor() {
    this.parentOrigin = this.deriveParentOrigin() || 'http://localhost:5173';
    
    // Initialize components
    this.messageHandler = new MessageHandler(this.parentOrigin);
    this.navigationTracker = new NavigationTracker();
    
    // Connect navigation tracking to message sending
    this.navigationTracker.onNavigationChange = (url, pathname) => {
      this.messageHandler.sendMessage('navigation', {
        url: url,
        pathname: pathname
      });
    };

    // Send initial navigation message
    this.messageHandler.sendMessage('navigation', {
      url: window.location.href,
      pathname: window.location.pathname
    });
  }

  deriveParentOrigin() {
    try {
      const ref = document.referrer;
      if (!ref) return null;
      const u = new URL(ref);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
}

// Initialize the navigation listener when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new NavigationListener();
  });
} else {
  new NavigationListener();
}

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationListener;
} else if (typeof window !== 'undefined') {
  window.NavigationListener = NavigationListener;
}
