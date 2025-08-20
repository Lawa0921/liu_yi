/*
	Forty by HTML5 UP - Fixed version without skel dependency
*/

(function($) {

	// Simple breakpoint detection
	var breakpoints = {
		xlarge: '(max-width: 1680px)',
		large: '(max-width: 1280px)',
		medium: '(max-width: 980px)',
		small: '(max-width: 736px)',
		xsmall: '(max-width: 480px)',
		xxsmall: '(max-width: 360px)'
	};

	// Check if breakpoint is active
	function isBreakpointActive(name) {
		return window.matchMedia(breakpoints[name]).matches;
	}

	// Simple parallax function
	$.fn._parallax = function(intensity) {
		var $window = $(window),
			$this = $(this);

		if (this.length == 0 || intensity === 0)
			return $this;

		if (!intensity)
			intensity = 0.25;

		$this.each(function() {
			var $t = $(this);

			function updateParallax() {
				var pos = parseInt($window.scrollTop()) - parseInt($t.position().top);
				$t.css('background-position', 'center ' + (pos * (-1 * intensity)) + 'px');
			}

			if (!isBreakpointActive('medium')) {
				$t.css('background-position', 'center 100%, center 100%, center 0px');
				$window.on('scroll._parallax', updateParallax);
			} else {
				$t.css('background-position', '');
				$window.off('scroll._parallax');
			}
		});

		return $this;
	};

	$(function() {

		var	$window = $(window),
			$body = $('body'),
			$wrapper = $('#wrapper'),
			$header = $('#header'),
			$banner = $('#banner');

		// Disable animations/transitions until the page has loaded.
		$body.addClass('is-loading');

		window.setTimeout(function() {
			$body.removeClass('is-loading');
		}, 200);

		// Clear transitioning state on unload/hide.
		$window.on('unload pagehide', function() {
			window.setTimeout(function() {
				$('.is-transitioning').removeClass('is-transitioning');
			}, 250);
		});

		// Fix: Placeholder polyfill.
		if ($('form').length > 0) {
			$('form').each(function() {
				// Simple placeholder polyfill for older browsers
				$(this).find('input[placeholder], textarea[placeholder]').each(function() {
					var $input = $(this);
					if (!$input.val()) {
						$input.val($input.attr('placeholder'));
						$input.addClass('placeholder');
						$input.on('focus', function() {
							if ($input.hasClass('placeholder')) {
								$input.val('').removeClass('placeholder');
							}
						}).on('blur', function() {
							if (!$input.val()) {
								$input.val($input.attr('placeholder')).addClass('placeholder');
							}
						});
					}
				});
			});
		}

		// Scrolly links.
		$('.scrolly').on('click', function(e) {
			e.preventDefault();
			var target = $(this.getAttribute('href'));
			if (target.length) {
				var offset = $header.height() - 2;
				$('html, body').stop().animate({
					scrollTop: target.offset().top - offset
				}, 1000);
			}
		});

		// Tiles.
		var $tiles = $('.tiles > article');

		$tiles.each(function() {
			var $this = $(this),
				$image = $this.find('.image'), 
				$img = $image.find('img'),
				$link = $this.find('.link'),
				x;

			// Image.
			if ($img.length) {
				// Set image.
				$this.css('background-image', 'url(' + $img.attr('src') + ')');

				// Set position.
				if (x = $img.data('position'))
					$image.css('background-position', x);

				// Hide original.
				$image.hide();
			}

			// Link.
			if ($link.length > 0) {
				var $x = $link.clone()
					.text('')
					.addClass('primary')
					.appendTo($this);
				
				$x.attr('aria-label', $link.text());
				$link = $link.add($x);

				$link.on('click', function(event) {
					var href = $link.attr('href');

					// Prevent default.
					event.stopPropagation();
					event.preventDefault();

					// Start transitioning.
					$this.addClass('is-transitioning');
					$wrapper.addClass('is-transitioning');

					// Redirect.
					window.setTimeout(function() {
						if ($link.attr('target') == '_blank')
							window.open(href);
						else
							location.href = href;
					}, 500);
				});
			}
		});

		// Header.
		if ($banner.length > 0 && $header.hasClass('alt')) {
			var headerHeight = $header.height();
			var scrollThreshold = headerHeight + 10;

			function updateHeader() {
				var scrollTop = $window.scrollTop();
				
				if (scrollTop > scrollThreshold) {
					// Past banner, show fixed header
					if ($header.hasClass('alt')) {
						$header.removeClass('alt').addClass('reveal');
					}
				} else {
					// In banner area, show alt header
					if (!$header.hasClass('alt')) {
						$header.addClass('alt').removeClass('reveal');
					}
				}
			}

			var scrollTimeout;
			$window.on('scroll', function() {
				if (scrollTimeout) clearTimeout(scrollTimeout);
				scrollTimeout = setTimeout(updateHeader, 10);
			});

			$window.on('resize', function() {
				headerHeight = $header.height();
				scrollThreshold = headerHeight + 10;
				updateHeader();
			});

			// Initial update
			setTimeout(updateHeader, 100);
		}

		// Banner.
		$banner.each(function() {
			var $this = $(this),
				$image = $this.find('.image'), 
				$img = $image.find('img');

			// Parallax.
			$this._parallax(0.275);

			// Image.
			if ($image.length > 0) {
				// Set image.
				$this.css('background-image', 'url(' + $img.attr('src') + ')');
				// Hide original.
				$image.hide();
			}
		});

		// Menu.
		var $menu = $('#menu'),
			$menuInner;

		if ($menu.length > 0) {
			$menu.wrapInner('<div class="inner"></div>');
			$menuInner = $menu.children('.inner');
			$menu._locked = false;

			$menu._lock = function() {
				if ($menu._locked) return false;
				$menu._locked = true;
				window.setTimeout(function() {
					$menu._locked = false;
				}, 350);
				return true;
			};

			$menu._show = function() {
				if ($menu._lock())
					$body.addClass('is-menu-visible');
			};

			$menu._hide = function() {
				if ($menu._lock())
					$body.removeClass('is-menu-visible');
			};

			$menu._toggle = function() {
				if ($menu._lock())
					$body.toggleClass('is-menu-visible');
			};

			$menuInner
				.on('click', function(event) {
					event.stopPropagation();
				})
				.on('click', 'a', function(event) {
					var href = $(this).attr('href');
					event.preventDefault();
					event.stopPropagation();

					// Hide.
					$menu._hide();

					// Redirect.
					window.setTimeout(function() {
						window.location.href = href;
					}, 250);
				});

			$menu
				.appendTo($body)
				.on('click', function(event) {
					event.stopPropagation();
					event.preventDefault();
					$body.removeClass('is-menu-visible');
				})
				.append('<a class="close" href="#menu">Close</a>');

			$body
				.on('click', 'a[href="#menu"]', function(event) {
					event.stopPropagation();
					event.preventDefault();
					// Toggle.
					$menu._toggle();
				})
				.on('click', function(event) {
					// Hide.
					$menu._hide();
				})
				.on('keydown', function(event) {
					// Hide on escape.
					if (event.keyCode == 27)
						$menu._hide();
				});
		}

		// Line Modal
		var $lineModal = $('#line-modal'),
			$lineInner;

		if ($lineModal.length > 0) {
			$lineInner = $lineModal.children('.inner');
			$lineModal._locked = false;

			$lineModal._lock = function() {
				if ($lineModal._locked) return false;
				$lineModal._locked = true;
				window.setTimeout(function() {
					$lineModal._locked = false;
				}, 350);
				return true;
			};

			$lineModal._show = function() {
				if ($lineModal._lock())
					$body.addClass('is-line-visible');
			};

			$lineModal._hide = function() {
				if ($lineModal._lock())
					$body.removeClass('is-line-visible');
			};

			$lineModal._toggle = function() {
				if ($lineModal._lock())
					$body.toggleClass('is-line-visible');
			};

			$lineInner
				.on('click', function(event) {
					event.stopPropagation();
				});

			$lineModal
				.appendTo($body)
				.on('click', function(event) {
					event.stopPropagation();
					event.preventDefault();
					$body.removeClass('is-line-visible');
				});

			$body
				.on('click', 'a[href="#line"]', function(event) {
					event.stopPropagation();
					event.preventDefault();
					// Toggle.
					$lineModal._toggle();
				})
				.on('keydown', function(event) {
					// Hide on escape.
					if (event.keyCode == 27)
						$lineModal._hide();
				});
		}

		// Responsive handling
		$window.on('resize', function() {
			// Update parallax on resize
			$banner._parallax(0.275);
		});

	});

})(jQuery);