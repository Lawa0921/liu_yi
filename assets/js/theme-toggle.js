(function() {
  // Theme toggle functionality
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle.querySelector('i');
  const html = document.documentElement;
  
  // Check for saved theme preference or default to 'light'
  const currentTheme = localStorage.getItem('theme') || 'light';
  
  // Apply saved theme on page load
  if (currentTheme === 'dark') {
    html.setAttribute('data-theme', 'dark');
    themeIcon.classList.remove('fa-moon-o');
    themeIcon.classList.add('fa-sun-o');
    themeToggle.setAttribute('aria-label', 'Toggle light mode');
  }
  
  // Theme toggle click handler
  themeToggle.addEventListener('click', function() {
    const isDark = html.getAttribute('data-theme') === 'dark';
    
    if (isDark) {
      // Switch to light mode
      html.removeAttribute('data-theme');
      themeIcon.classList.remove('fa-sun-o');
      themeIcon.classList.add('fa-moon-o');
      themeToggle.setAttribute('aria-label', 'Toggle dark mode');
      localStorage.setItem('theme', 'light');
    } else {
      // Switch to dark mode
      html.setAttribute('data-theme', 'dark');
      themeIcon.classList.remove('fa-moon-o');
      themeIcon.classList.add('fa-sun-o');
      themeToggle.setAttribute('aria-label', 'Toggle light mode');
      localStorage.setItem('theme', 'dark');
    }
  });
})();