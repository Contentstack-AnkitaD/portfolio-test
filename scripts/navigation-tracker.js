// Navigation tracking functionality
class NavigationTracker {
  constructor() {
    this.currentUrl = window.location.href;
    this.currentPathname = window.location.pathname;
    this.init();
  }

  init() {
    window.addEventListener('popstate', () => {
      this.handleNavigation();
    });

    this.interceptHistoryMethods();
  }

  interceptHistoryMethods() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleNavigation();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.handleNavigation();
    };
  }

  handleNavigation() {
    const newUrl = window.location.href;
    const newPathname = window.location.pathname;
    
    if (newUrl !== this.currentUrl || newPathname !== this.currentPathname) {
      this.currentUrl = newUrl;
      this.currentPathname = newPathname;
      this.onNavigationChange(newUrl, newPathname);
    }
  }

  onNavigationChange(url, pathname) {
    // Override this method in subclasses
    console.log('Navigation changed:', { url, pathname });
  }
}

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationTracker;
} else if (typeof window !== 'undefined') {
  window.NavigationTracker = NavigationTracker;
}
