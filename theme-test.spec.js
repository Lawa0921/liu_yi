/**
 * Theme Switching Test Suite
 * 
 * This test suite verifies that the dark/light mode functionality works correctly
 * To run these tests manually in the browser console:
 * 1. Open the website
 * 2. Open browser developer tools (F12)
 * 3. Copy and paste this entire file into the console
 * 4. The test results will be displayed in the console
 */

(function() {
    let testsPassed = 0;
    let testsFailed = 0;
    
    function assert(condition, message) {
        if (condition) {
            console.log('✅ PASS:', message);
            testsPassed++;
        } else {
            console.error('❌ FAIL:', message);
            testsFailed++;
        }
    }
    
    function runTests() {
        console.log('🧪 Starting Theme Switching Tests...\n');
        
        // Test 1: Check if theme toggle button exists
        const themeToggle = document.getElementById('theme-toggle');
        assert(themeToggle !== null, 'Theme toggle button exists');
        
        // Test 2: Check if theme toggle button has correct initial state
        const icon = themeToggle ? themeToggle.querySelector('i') : null;
        assert(icon !== null, 'Theme toggle button has icon');
        
        // Test 3: Check if CSS variables are defined
        const rootStyles = getComputedStyle(document.documentElement);
        const bgColor = rootStyles.getPropertyValue('--bg');
        assert(bgColor !== '', 'CSS variable --bg is defined');
        
        // Test 4: Check localStorage functionality
        const initialTheme = localStorage.getItem('theme');
        assert(initialTheme === null || initialTheme === 'light' || initialTheme === 'dark', 
               'Theme in localStorage is valid or null');
        
        // Test 5: Simulate theme toggle
        if (themeToggle) {
            const htmlElement = document.documentElement;
            const initialDataTheme = htmlElement.getAttribute('data-theme');
            
            // Click the toggle button
            themeToggle.click();
            
            // Check if data-theme attribute changed
            const newDataTheme = htmlElement.getAttribute('data-theme');
            assert(
                (initialDataTheme === 'dark' && newDataTheme === null) ||
                (initialDataTheme !== 'dark' && newDataTheme === 'dark'),
                'Theme toggle changes data-theme attribute'
            );
            
            // Test 6: Check if localStorage was updated
            const savedTheme = localStorage.getItem('theme');
            assert(
                (newDataTheme === 'dark' && savedTheme === 'dark') ||
                (newDataTheme === null && savedTheme === 'light'),
                'Theme preference is saved to localStorage'
            );
            
            // Test 7: Check if icon changed
            const iconClassChanged = (newDataTheme === 'dark' && icon.classList.contains('fa-sun-o')) ||
                                   (newDataTheme !== 'dark' && icon.classList.contains('fa-moon-o'));
            assert(iconClassChanged, 'Icon changes when theme is toggled');
            
            // Test 8: Check if CSS variables are applied
            const newBgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg');
            assert(
                (newDataTheme === 'dark' && newBgColor.includes('242943')) ||
                (newDataTheme !== 'dark' && newBgColor.includes('ffffff')),
                'CSS variables change with theme'
            );
            
            // Toggle back to original state
            themeToggle.click();
        }
        
        // Test 9: Check theme persistence (simulated)
        const testTheme = 'dark';
        localStorage.setItem('theme', testTheme);
        
        // Simulate page reload by manually triggering theme application
        if (window.themeToggle) {
            // If the theme toggle script exposed a function, use it
            console.log('Note: Full persistence test requires page reload');
        }
        
        // Clean up test
        if (initialTheme === null) {
            localStorage.removeItem('theme');
        } else {
            localStorage.setItem('theme', initialTheme);
        }
        
        // Test 10: Check button visibility
        if (themeToggle) {
            const buttonStyles = getComputedStyle(themeToggle);
            const isVisible = buttonStyles.display !== 'none' && 
                            buttonStyles.visibility !== 'hidden' &&
                            parseFloat(buttonStyles.opacity) > 0;
            assert(isVisible, 'Theme toggle button is visible');
        }
        
        console.log('\n📊 Test Results:');
        console.log(`✅ Passed: ${testsPassed}`);
        console.log(`❌ Failed: ${testsFailed}`);
        console.log(`📈 Total: ${testsPassed + testsFailed}`);
        
        if (testsFailed === 0) {
            console.log('\n🎉 All tests passed! Theme switching is working correctly.');
        } else {
            console.log('\n⚠️ Some tests failed. Please check the implementation.');
        }
    }
    
    // Run tests
    runTests();
})();