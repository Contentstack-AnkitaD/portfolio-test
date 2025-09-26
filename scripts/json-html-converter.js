/**
 * Advanced Browser-based HTML to Composable JSON Converter
 * 
 * This version attempts to match the backend logic more closely,
 * including handling of Tailwind classes, responsive styles, and special cases.
 * 
 * FIXED: CSS text truncation issue where elements with line-clamp-3 or similar
 * classes were showing "..." instead of full text content in the JSON output.
 * The getFullTextContent() function now properly extracts the complete text
 * even when CSS truncation is applied.
 * 
 * ENHANCED: Metadata handling with source correlation for better debugging and
 * element tracking. Each element now includes:
 * - title: Descriptive title with element type, ID/class, and content preview
 * - sourceInfo: Original element details (tagName, id, className, data attributes, position)
 * - elementPath: CSS selector path for easy element location
 * - contentPreview: First 50 characters of text content
 * - Special metadata for media elements (images, videos), links, forms, and custom components
 * 
 * MODIFIED: Now works with postMessage communication instead of file download
 * for integration with Composable Studio.
 */

// Constants matching backend
const MEDIA_TAGS = ["IMG", "VIDEO"];
const HTML_RTE_COMPONENTS = ["richTextEditor", "htmlRte"];
// === style capture config ===
const STYLE_MODE = 'uaDiffPlusInherited'; 
// options: 'uaDiff' | 'inheritedOnly' | 'uaDiffPlusInherited' | 'all'

const SUPPORTED_PROPS = [
  // layout
  'display','position','top','right','bottom','left','z-index',
  'width','height','min-width','min-height','max-width','max-height','aspect-ratio',
  'overflow','overflow-x','overflow-y',
  // spacing
  'margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left',
  // background
  'background-color','background-image','background-repeat',
  'background-size','background-position','background-clip','background-origin','background-attachment',
  'background-blend-mode',
  // border
  'border-top-width','border-right-width','border-bottom-width','border-left-width',
  'border-top-style','border-right-style','border-bottom-style','border-left-style',
  'border-top-color','border-right-color','border-bottom-color','border-left-color',
  'border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius',
  'border-image',
  // effects
  'box-shadow','opacity','transform','filter','backdrop-filter','mix-blend-mode','clip-path','mask',
  // text
  'color','font-family','font-size','font-weight','font-style','line-height',
  'letter-spacing','text-transform','text-decoration-line','text-decoration-color','text-decoration-thickness','text-underline-offset',
  'text-align','white-space','text-overflow','overflow-wrap','word-break',
  // flex
  'flex','flex-grow','flex-shrink','flex-basis','flex-direction','flex-wrap',
  'align-items','justify-content','align-content','align-self','gap',
  // grid
  'grid-template-columns','grid-template-rows','grid-auto-flow','grid-auto-rows','grid-auto-columns',
  'grid-column','grid-row','row-gap','column-gap','place-items','place-content','justify-items','justify-self',
  // lists/tables
  'list-style','list-style-type','list-style-position','list-style-image',
  'table-layout','border-collapse','border-spacing',
  // visibility & interaction
  'visibility','pointer-events','user-select','cursor',
  // media
  'object-fit','object-position'
];

const INHERITABLE = new Set([
  'color','font','font-family','font-feature-settings','font-kerning','font-language-override',
  'font-size','font-size-adjust','font-stretch','font-style','font-synthesis','font-variant',
  'font-variant-caps','font-variant-ligatures','font-variant-numeric','font-variant-position',
  'font-weight','letter-spacing','line-height','text-align','text-align-last','text-indent',
  'text-justify','text-shadow','text-transform','white-space','word-break','word-spacing','word-wrap',
  'direction','unicode-bidi','writing-mode',
  'list-style','list-style-image','list-style-position','list-style-type',
  'cursor','quotes','tab-size','visibility','pointer-events'
]);

// Store the last conversion result
let lastConversionResult = null;

// Utility functions
const browserUtils = {
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  // Get component name (matching backend getComponentName logic)
  getComponentName(element) {
    const htmlTag = element.tagName.toLowerCase();
    
    switch (htmlTag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "header";
      case "a": {
        // Check if <a> tag has child elements (images, spans, etc.)
        const hasChildElements = element.children.length > 0;
        
        if (hasChildElements) {
          return "link-container";
        } else {
          return "link";
        }
      }
      case "video":
        return "video";
      case "section":
        return "section";
      case "p":
      case "span":
      case "label":
        return "text";
      case "button":
        return "button";
      case "img":
      case "svg":
        return "image";
      case "div": {
        // Check if div contains only text content (no child elements)
        const hasOnlyTextContent = element.children.length === 0 && element.textContent.trim();
        
        if (hasOnlyTextContent) {
          return "text";
        }
        
        const computedStyles = window.getComputedStyle(element);
        if (computedStyles.display === "flex") {
          if (computedStyles.flexDirection === "column") {
            return "vstack";
          } else {
            return "hstack";
          }
        } else if (computedStyles.display === "grid") {
          // TODO: use grid component once it is available in SDK
          return "box";
        } else {
          return "box";
        }
      }
      default: {
        // Check if any element contains only text content (no child elements)
        const hasOnlyTextContent = element.children.length === 0 && element.textContent.trim();
        
        if (hasOnlyTextContent) {
          return "text";
        }
        
        return "box";
      }
    }
  },

getAppliedStyles(element, { mode = STYLE_MODE, whitelist = SUPPORTED_PROPS } = {}) {
  // Ensure a clean UA baseline in an offscreen iframe
  if (!this._baselineFrame) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-99999px';
    iframe.style.top = '0';
    iframe.setAttribute('aria-hidden', 'true');
    // create minimal doc
    document.documentElement.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write('<!doctype html><html><head></head><body></body></html>');
    iframe.contentDocument.close();
    this._baselineFrame = iframe;
    this._baselineCache = new Map(); // tagName -> CSSStyleDeclaration snapshot
  }

  const camel = (prop) => prop.replace(/-([a-z])/g, (_,c)=>c.toUpperCase());
  const toKebab = (prop) => prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

  const cs = getComputedStyle(element);

  // parent computed (for inherited)
  const parent = element.parentElement;
  const ps = parent ? getComputedStyle(parent) : null;

  // UA baseline for this tag (cached)
  const tag = element.tagName;
  let ua = this._baselineCache.get(tag);
  if (!ua) {
    const doc = this._baselineFrame.contentDocument;
    const probe = doc.createElement(tag);
    (doc.body || doc.documentElement).appendChild(probe);
    ua = this._baselineFrame.contentWindow.getComputedStyle(probe);
    this._baselineCache.set(tag, ua);
    probe.remove();
  }

  // Collect
  const outKebab = {};
  for (const prop of cs) {
    const val = cs.getPropertyValue(prop);
    if (!val || val === 'initial' || val === 'unset') continue;

    let include = false;

    switch (mode) {
      case 'all':
        include = true;
        break;

      case 'inheritedOnly':
        if (ps && INHERITABLE.has(prop)) {
          include = (val === ps.getPropertyValue(prop));
        }
        break;

      case 'uaDiff':
        include = (val !== ua.getPropertyValue(prop));
        break;

      case 'uaDiffPlusInherited':
      default: {
        const diffUA = (val !== ua.getPropertyValue(prop));
        const inherited = ps && INHERITABLE.has(prop) && (val === ps.getPropertyValue(prop));
        include = diffUA || inherited;
        break;
      }
    }

    if (!include) continue;

    if (whitelist && whitelist.length) {
      if (!whitelist.includes(prop)) continue;
    }

    outKebab[prop] = val;
  }

  // Convert to camelCase for JSON shape used later
  const outCamel = {};
  for (const [k,v] of
     Object.entries(outKebab)) outCamel[camel(k)] = v;

  // Button-like anchors: keep padding/background/border by ensuring inline-block
  if (element.tagName === 'A') {
    const cls = (element.className && typeof element.className === 'string') ? element.className : '';
    if (/(btn|button|cta)/i.test(cls) && !outCamel.display) outCamel.display = 'inline-block';
  }

  return outCamel;
},

// REPLACE the whole getElementResponsiveStyles with this:
getElementResponsiveStyles(element, designTokens = {}) {
  try {
    // Computed styles using UA-diff + inherited and the expanded whitelist
    const stylesDefault = this.getAppliedStyles(element);

    // Inline styles present on the element attribute
    const inlineStyles = this.handleInlineStyles(element, designTokens) || {};

    // Additional styles inferred from classes and tag-specific rules
    const classList = Array.from(element.classList || []);
    const additional = this.handleAdditionalStyles(element, classList) || { default: {} };

    // Merge with priority: computed -> additional.default -> inline
    // Inline wins so explicit inline declarations are preserved
    const mergedDefault = { ...stylesDefault, ...(additional.default || {}), ...inlineStyles };

    return {
      default: mergedDefault,
      tablet: {},  // left intentionally empty; recomputed per mode in Studio
      mobile: {}
    };
  } catch (err) {
    console.error(`Error getting styles: ${err}`);
    return { default: {}, tablet: {}, mobile: {} };
  }
},


  // Fetch utility classes (matching backend fetchUtilityClasses)
  fetchUtilityClasses(classes, utilities) {
    return classes.filter((className) => {
      return utilities.some((utility) => className.startsWith(utility));
    });
  },

  // Convert Tailwind class to CSS (simplified version)
  convertTailwindToCSS(className) {
    // This is a simplified version - in real implementation you'd use tw-to-css library
    const cssMap = {
      'flex': { display: 'flex' },
      'grid': { display: 'grid' },
      'block': { display: 'block' },
      'inline-block': { display: 'inline-block' },
      'inline': { display: 'inline' },
      'hidden': { display: 'none' },
      'text-center': { textAlign: 'center' },
      'text-left': { textAlign: 'left' },
      'text-right': { textAlign: 'right' },
      'justify-center': { justifyContent: 'center' },
      'justify-start': { justifyContent: 'flex-start' },
      'justify-end': { justifyContent: 'flex-end' },
      'justify-between': { justifyContent: 'space-between' },
      'items-center': { alignItems: 'center' },
      'items-start': { alignItems: 'flex-start' },
      'items-end': { alignItems: 'flex-end' },
      'bg-white': { backgroundColor: '#ffffff' },
      'bg-black': { backgroundColor: '#000000' },
      'text-white': { color: '#ffffff' },
      'text-black': { color: '#000000' },
      'p-4': { padding: '1rem' },
      'm-4': { margin: '1rem' },
      'w-full': { width: '100%' },
      'h-full': { height: '100%' },
      'rounded': { borderRadius: '0.25rem' },
      'border': { borderWidth: '1px', borderStyle: 'solid' }
    };
    
    return cssMap[className] || {};
  },

  // Handle additional styles (matching backend handleAdditionalStyles)
  handleAdditionalStyles(element, classList) {
    const styles = {
      default: {},
      tablet: {},
      mobile: {},
    };
    let additionalStyles = {};

    // Style applicable to all elements
    classList.includes("border") && (additionalStyles.borderStyle = "solid");

    // Style applicable to specific elements
    const htmlTag = element.tagName.toLowerCase();
    switch (htmlTag) {
      case "img":
        additionalStyles = {
          ...additionalStyles,
          maxWidth: "100%",
        };
        break;
      case "button":
        additionalStyles = {
          ...additionalStyles,
          backgroundColor: "transparent",
          backgroundImage: "none",
        };
        !classList.includes("border") && (additionalStyles.border = "unset");
        break;
      case "div":
        classList.forEach((className) => {
          if (className.startsWith("bg-opacity")) {
            const opacityValue = Number(className.split("-")[2])/100;
            additionalStyles = {
              ...additionalStyles,
              opacity: opacityValue,
            };
          }
          if (className.startsWith("border")) {
            additionalStyles = {
              ...additionalStyles,
              border: "0 solid",
            };
          }
        });
        break;
      case "p":
        additionalStyles = {
          ...additionalStyles,
          display: "inline-block",
        };
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        additionalStyles = {
          ...additionalStyles,
          display: "block",
        };
        break;
      case "ul":
      case "ol":
      case "nav": {
        // Preserve flex/grid, spacing, and list styles
        const cs = window.getComputedStyle(element);
        
        // Debug logging for ul/nav elements
        if (classList.includes('nav-ul') || classList.includes('header-ul')) {
          console.log('🔍 UL/NAV Debug - Element:', element);
          console.log('🔍 UL/NAV Debug - Classes:', classList);
          console.log('🔍 UL/NAV Debug - Computed display:', cs.display);
          console.log('🔍 UL/NAV Debug - Computed flexDirection:', cs.flexDirection);
          console.log('🔍 UL/NAV Debug - Computed alignItems:', cs.alignItems);
          console.log('🔍 UL/NAV Debug - Computed padding:', cs.padding);
          console.log('🔍 UL/NAV Debug - Computed margin:', cs.margin);
        }
        
        // Layout
        if (cs.display === "flex") {
          additionalStyles.display = "flex";
          additionalStyles.flexDirection = cs.flexDirection;
          additionalStyles.justifyContent = cs.justifyContent;
          additionalStyles.alignItems = cs.alignItems;
          additionalStyles.gap = cs.gap;
        } else if (cs.display === "grid") {
          additionalStyles.display = "grid";
          additionalStyles.gridTemplateColumns = cs.gridTemplateColumns;
          additionalStyles.gridTemplateRows = cs.gridTemplateRows;
          additionalStyles.gap = cs.gap;
        } else {
          additionalStyles.display = cs.display;
        }
        // List-specific
        additionalStyles.listStyleType = cs.listStyleType;
        additionalStyles.listStylePosition = cs.listStylePosition;
        additionalStyles.listStyleImage = cs.listStyleImage;
        // Spacing
        additionalStyles.marginTop = cs.marginTop;
        additionalStyles.marginBottom = cs.marginBottom;
        additionalStyles.paddingLeft = cs.paddingLeft;
        additionalStyles.paddingRight = cs.paddingRight;
        break;
      }
      case "li": {
        // List item styles
        const cs = window.getComputedStyle(element);
        
        // Debug logging for li elements
        if (classList.includes('nav-li') || classList.includes('footer-nav-li')) {
          console.log('🔍 LI Debug - Element:', element);
          console.log('🔍 LI Debug - Classes:', classList);
          console.log('🔍 LI Debug - Computed display:', cs.display);
          console.log('🔍 LI Debug - Computed padding:', cs.padding);
          console.log('🔍 LI Debug - Computed paddingLeft:', cs.paddingLeft);
          console.log('🔍 LI Debug - Computed paddingRight:', cs.paddingRight);
          console.log('🔍 LI Debug - Computed letterSpacing:', cs.letterSpacing);
          console.log('🔍 LI Debug - Computed textTransform:', cs.textTransform);
        }
        
        additionalStyles.display = cs.display;
        additionalStyles.listStyleType = cs.listStyleType;
        additionalStyles.listStylePosition = cs.listStylePosition;
        additionalStyles.listStyleImage = cs.listStyleImage;
        additionalStyles.marginTop = cs.marginTop;
        additionalStyles.marginBottom = cs.marginBottom;
        additionalStyles.paddingLeft = cs.paddingLeft;
        additionalStyles.paddingRight = cs.paddingRight;
        additionalStyles.letterSpacing = cs.letterSpacing;
        additionalStyles.textTransform = cs.textTransform;
        break;
      }
    }

    styles.default = additionalStyles;
    return styles;
  },

  // Handle inline styles (simplified version)
  handleInlineStyles(element, designTokens) {
    const style = element.getAttribute('style');
    if (!style) return {};
    
    const styles = {};
    const declarations = style.split(';');
    
    declarations.forEach(declaration => {
      const [property, value] = declaration.split(':').map(s => s.trim());
      if (property && value) {
        const camelProperty = property.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        styles[camelProperty] = value;
      }
    });
    
    return styles;
  },

  // Handle gradient classes (simplified version)
  handleGradientClass(classList, className) {
    const gradientPosition = classList.indexOf(className);
    const gradientColors = (classList.slice(gradientPosition+1, gradientPosition+3)).join(" ");
    const gradientClassName = `${className} ${gradientColors}`;
    
    // Extract gradient type and direction
    const typeMatch = gradientClassName.match(/(bg|border)-gradient-(to-[trbl]{1,2})/);
    const type = typeMatch ? typeMatch[1] : 'bg';
    const direction = typeMatch ? this.getDirectionMap(typeMatch[2]) || 'to right' : 'to right';
    
    // Extract color stops
    const fromMatch = gradientClassName.match(/from-(\[[^\]]+\]|[a-zA-Z0-9-]+)/);
    const viaMatch = gradientClassName.match(/via-(\[[^\]]+\]|[a-zA-Z0-9-]+)/);
    const toMatch = gradientClassName.match(/to-(?!t|r|b|l|tr|tl|br|bl)(\[[^\]]+\]|[a-zA-Z0-9-]+)/);
    
    // Process colors
    const from = fromMatch ? this.processColor(fromMatch[1]) : '';
    const via = viaMatch ? this.processColor(viaMatch[1]) : '';
    const to = toMatch ? this.processColor(toMatch[1]) : '';
    
    // Build gradient
    let gradient = `linear-gradient(${direction}`;
    if (from) gradient += `, ${from}`;
    if (via) gradient += `, ${via}`;
    if (to) gradient += `, ${to}`;
    gradient += ')';
    
    return type === 'bg' ? { background: gradient } : { borderImage: gradient };
  },

  // Process color (matching backend processColor)
  processColor(color) {
    // Handle bracket notation (e.g., [#C3DFED])
    if (color.startsWith('[') && color.endsWith(']')) {
      return color.slice(1, -1);
    }
    // Check if the color exists in our mapping
    return this.getColorMap()[color] || color;
  },

  // Get direction map (simplified)
  getDirectionMap() {
    return {
      'to-t': 'to top',
      'to-r': 'to right', 
      'to-b': 'to bottom',
      'to-l': 'to left',
      'to-tr': 'to top right',
      'to-tl': 'to top left',
      'to-br': 'to bottom right',
      'to-bl': 'to bottom left'
    };
  },

  // Get color map (simplified)
  getColorMap() {
    return {
      'red': '#ef4444',
      'blue': '#3b82f6',
      'green': '#22c55e',
      'gray': '#6b7280',
      'white': '#ffffff',
      'black': '#000000'
    };
  },

  // Convert Tailwind class to CSS with design tokens (simplified)
  convertTailwindClassToCSS(className, designTokens) {
    // This would need the actual design token conversion logic
    // For now, return empty object
    return {};
  },

  // Handle text nodes (matching backend handleTextNode)
  handleTextNode(textContent, elementJSON, previousValue = '') {
    if (textContent.trim()) {
      // Clean up the text content - remove any CSS truncation artifacts
      let cleanText = textContent.trim();
      
      // Remove trailing "..." that might be added by CSS truncation
      cleanText = cleanText.replace(/\.{3,}$/, '');
      
      // If the text is just "...", try to get the full text from the element
      if (cleanText === '...' || cleanText === '') {
        // This might be a CSS-truncated element, try to get full content
        return;
      }
      
      elementJSON.props.text = {
        type: "string",
        staticString: previousValue ? previousValue+" "+cleanText : cleanText,
      };
    }
  },

  // Handle link elements with enhanced metadata
  handleLinkElement(element, elementJSON) {
    if (element.tagName !== "A") return;
    
    const href = element.getAttribute("href");
    const target = element.getAttribute("target");
    const rel = element.getAttribute("rel");
    const textContent = element.textContent?.trim() || '';
    
    // Set link properties (matching backend structure)
    elementJSON.props.href = {
      type: "string",
      staticString: href,
    };
    elementJSON.props.label = {
      type: "string",
      staticString: textContent,
    };
    
    // Add additional link properties if they exist
    if (target) {
      elementJSON.props.target = {
        type: "string",
        staticString: target,
      };
    }
    if (rel) {
      elementJSON.props.rel = {
        type: "string",
        staticString: rel,
      };
    }
    
    // Add link-specific metadata
    elementJSON.metadata.linkInfo = {
      href: href,
      target: target || '_self',
      rel: rel || '',
      isExternal: href && (href.startsWith('http') || href.startsWith('//')),
      isInternal: href && href.startsWith('#'),
      isEmail: href && href.startsWith('mailto:'),
      isPhone: href && href.startsWith('tel:'),
      textContent: textContent
    };
  },

  // Handle form elements with enhanced metadata
  handleFormElement(element, elementJSON) {
    const formElements = ['input', 'textarea', 'select', 'form'];
    if (!formElements.includes(element.tagName.toLowerCase())) return;
    
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    const name = element.getAttribute('name');
    const placeholder = element.getAttribute('placeholder');
    const required = element.hasAttribute('required');
    
    // Add form-specific metadata
    elementJSON.metadata.formInfo = {
      elementType: tagName,
      inputType: type || 'text',
      name: name || '',
      placeholder: placeholder || '',
      required: required,
      value: element.value || '',
      options: tagName === 'select' ? Array.from(element.options).map(opt => ({
        value: opt.value,
        text: opt.text,
        selected: opt.selected
      })) : []
    };
  },

  // Handle button elements (matching backend handleButtonElement)
  handleButtonElement(textContent, elementJSON) {
    elementJSON.props.label = {
      type: "string",
      staticString: textContent,
    };
  },

  // Handle image elements (matching backend handleImageElement)
  handleImageElement(element, elementJSON) {
    if (element.tagName !== "IMG") return;
    const src = element.getAttribute("src");
    const alt = element.getAttribute("alt");
    
    // Resolve relative URLs to absolute URLs for Composable Studio
    const absoluteSrc = new URL(element.src, window.location.href).href;
    
    elementJSON.props.src = {
      type: "imageUrl",
      staticString: absoluteSrc,
    };
    elementJSON.props.alt = {
      type: "string",
      staticValue: alt,
    };
    
    // Add image-specific metadata
    elementJSON.metadata.mediaInfo = {
      type: 'image',
      src: absoluteSrc,  // Use absolute URL in metadata too
      alt: alt,
      dimensions: {
        width: element.naturalWidth || element.width,
        height: element.naturalHeight || element.height
      },
      loading: element.loading || 'eager',
      decoding: element.decoding || 'auto'
    };
  },

  // Handle video elements (matching backend handleVideoElement)
  handleVideoElement(element, elementJSON) {
    if (element.tagName !== "VIDEO") return;
    const sources = Array.from(element.getElementsByTagName("source"));
    elementJSON.attrs.src = sources[0].getAttribute("src");
    elementJSON.attrs.type = sources[0].getAttribute("type");
    
    // Add video-specific metadata
    elementJSON.metadata.mediaInfo = {
      type: 'video',
      sources: sources.map(source => ({
        src: source.getAttribute("src"),
        type: source.getAttribute("type"),
        media: source.getAttribute("media")
      })),
      controls: element.hasAttribute("controls"),
      autoplay: element.hasAttribute("autoplay"),
      muted: element.hasAttribute("muted"),
      loop: element.hasAttribute("loop"),
      poster: element.getAttribute("poster")
    };
  },

  // Handle custom components (simplified version)
  handleCustomComponents(elementJSON, component) {
    if (component.codeComponentName) {
      elementJSON.type = component.codeComponentName;
    }
    if (component.propMappings) {
      elementJSON.props = { ...elementJSON.props, ...component.propMappings };
    }
    
    // Add component mapping metadata
    if (component.nodeId) {
      elementJSON.metadata.componentMapping = {
        figmaNodeId: component.nodeId,
        codeComponentName: component.codeComponentName,
        figmaComponentKey: component.figmaComponentKey,
        variantProperties: component.variantProperties || {}
      };
    }
  },

  // Get element attributes
  getElementAttributes(element) {
    const attrs = {};
    const attributes = element.attributes;
    
    for (let i = 0; i < attributes.length; i++) {
      const attr = attributes[i];
      if (attr.name !== 'class' && attr.name !== 'style') {
        attrs[attr.name] = attr.value;
      }
    }
    
    return attrs;
  },

  // Extract metadata with source correlation
  getElementMetadata(element) {
    const metadata = {
      title: '',
      sourceInfo: {},
      elementPath: '',
      contentPreview: ''
    };

    let tagName = 'unknown';

    try {
      // Generate a descriptive title based on element type and content
      tagName = element.tagName.toLowerCase();
      const id = element.id;
      const className = element.className;
      const textContent = element.textContent?.trim().substring(0, 50);
      
      // Build title with source correlation
      let title = `${tagName}`;
      
      if (id) {
        title += `#${id}`;
      } else if (className && typeof className === 'string' && className.trim()) {
        const firstClass = className.split(' ')[0];
        title += `.${firstClass}`;
      }
      
      if (textContent) {
        title += ` - "${textContent}${textContent.length >= 50 ? '...' : ''}"`;
      }
      
      metadata.title = title;

      // Store source information for correlation
      metadata.sourceInfo = {
        tagName: tagName,
        id: id || null,
        className: (className && typeof className === 'string') ? className : null,
        dataAttributes: {},
        position: this.getElementPosition(element)
      };

      // Get data attributes
      const dataAttrs = {};
      for (let attr of element.attributes) {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = attr.value;
        }
      }
      metadata.sourceInfo.dataAttributes = dataAttrs;

      // Generate element path for debugging
      metadata.elementPath = this.getElementPath(element);

      // Content preview
      metadata.contentPreview = textContent || '';

    } catch (error) {
      console.error('Error extracting metadata:', error);
      metadata.title = `element-${tagName}`;
    }

    return metadata;
  },

  // Get element position in DOM
  getElementPosition(element) {
    const position = {
      index: 0,
      parentType: '',
      siblingCount: 0
    };

    try {
      const parent = element.parentElement;
      if (parent) {
        position.parentType = parent.tagName.toLowerCase();
        
        // Get index among siblings
        const siblings = Array.from(parent.children);
        position.index = siblings.indexOf(element);
        position.siblingCount = siblings.length;
      }
    } catch (error) {
      console.error('Error getting element position:', error);
    }

    return position;
  },

  // Generate element path for debugging
  getElementPath(element) {
    const path = [];
    let current = element;

    try {
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        
        if (current.id) {
          selector += `#${current.id}`;
        } else if (current.className && typeof current.className === 'string' && current.className.trim()) {
          const classes = current.className.split(' ').filter(c => c.trim());
          if (classes.length > 0) {
            selector += `.${classes[0]}`;
          }
        }
        
        // Add position if multiple siblings
        const siblings = current.parentElement ? Array.from(current.parentElement.children) : [];
        const sameTypeSiblings = siblings.filter(s => s.tagName === current.tagName);
        if (sameTypeSiblings.length > 1) {
          const index = sameTypeSiblings.indexOf(current);
          selector += `:nth-of-type(${index + 1})`;
        }
        
        path.unshift(selector);
        current = current.parentElement;
      }
    } catch (error) {
      console.error('Error generating element path:', error);
    }

    return path.join(' > ');
  },

  // Convert SVG to base64 (simplified version)
  async convertSVGToBase64(element) {
    try {
      const svgString = element.outerHTML || element.innerHTML;
      const svgBase64 = 'data:image/svg+xml;base64,' + btoa(svgString);
      return svgBase64;
    } catch (error) {
      console.error('SVG conversion error:', error);
      return '';
    }
  },

  // Get full text content from potentially truncated elements
  getFullTextContent(element) {
    // Check if element has CSS truncation classes
    const hasTruncation = element.classList.contains('line-clamp-3') || 
                          element.classList.contains('line-clamp-2') ||
                          element.classList.contains('line-clamp-1') ||
                          element.style.textOverflow === 'ellipsis' ||
                          element.style.overflow === 'hidden';
    
    if (hasTruncation) {
      //console.log('🔍 Detected CSS truncation on element:', element.tagName, element.className);
      
      // Try to get the full text by temporarily removing truncation styles
      const originalStyles = {
        overflow: element.style.overflow,
        textOverflow: element.style.textOverflow,
        whiteSpace: element.style.whiteSpace,
        display: element.style.display
      };
      
      // Temporarily remove truncation styles
      element.style.overflow = 'visible';
      element.style.textOverflow = 'clip';
      element.style.whiteSpace = 'normal';
      element.style.display = 'block';
      
      // Get the full text content
      const fullText = element.textContent || element.innerText || '';
      
      // Restore original styles
      element.style.overflow = originalStyles.overflow;
      element.style.textOverflow = originalStyles.textOverflow;
      element.style.whiteSpace = originalStyles.whiteSpace;
      element.style.display = originalStyles.display;
      
      //console.log('📝 Extracted full text:', fullText.substring(0, 100) + (fullText.length > 100 ? '...' : ''));
      return fullText.trim();
    }
    
    // Return normal text content if no truncation detected
    return (element.textContent || element.innerText || '').trim();
  }
};

/**
 * Main conversion function matching backend logic
 */
async function convertHTMLToComposableJSON(element, componentMappings = [], designTokens = {}) {
  // Check for br elements (backend logic)
  if (element.tagName.toLowerCase() === "br") {
    return null;
  }

  // Get component mappings (backend logic)
  const figmaNodeId = element.getAttribute("data-figma-id");
  let component = {};

  componentMappings.forEach((componentMapping) => {
    const nodeId = componentMapping.nodeIds.find(node => node.nodeId === figmaNodeId);
    
    if (nodeId) {
      component = {
        codeComponentName: componentMapping.codeComponentName,
        propMappings: componentMapping.propMappings,
        nodeId: nodeId.nodeId,
        variantProperties: nodeId.variantProperties,
        figmaComponentKey: componentMapping.figmaComponentKey
      };
    }
  });

  const componentName = browserUtils.getComponentName(element);
  const style = browserUtils.getElementResponsiveStyles(element, designTokens);

  // Initialize elementJSON (matching backend structure)
  const elementJSON = {
    type: componentName,
    uid: browserUtils.generateUUID(),
    metadata: browserUtils.getElementMetadata(element),
    attrs: browserUtils.getElementAttributes(element),
    props: {},
    slots: {},
    styles: {
      default: {
        responsiveStyles: style,
      },
    },
  };

  // Handle custom components (backend logic)
  if (component?.nodeId) {
    browserUtils.handleCustomComponents(elementJSON, component);
  } else {
    // Backend logic for different element types
    const childNodes = Array.from(element.childNodes);
    const uid = browserUtils.generateUUID();
    const children = [];
    
    const hasBrElement = childNodes.some(
      (node) => node.nodeName.toLowerCase() === "br"
    );

    // Check for div elements with text content (backend logic)
    if (element.tagName.toLowerCase() === "div" && !childNodes.length && element?.textContent) {
      const textContent = browserUtils.getFullTextContent(element);
      const childJSON = {
        type: "text",
        uid: browserUtils.generateUUID(),
        metadata: browserUtils.getElementMetadata(element),
        attrs: {},
        props: {},
        slots: {},
        styles: {
          default: {
            responsiveStyles: style,
          },
        },
      };
      if (textContent.trim()) {
        browserUtils.handleTextNode(textContent, childJSON);
        children.push(childJSON);
      }
    }
    // Handle br elements (backend logic)
    else if (hasBrElement && !HTML_RTE_COMPONENTS.includes(componentName)) {
      const childJSON = {
        type: componentName,
        uid: browserUtils.generateUUID(),
        metadata: browserUtils.getElementMetadata(element),
        attrs: {},
        props: {},
        slots: {},
        styles: {
          default: {
            responsiveStyles: style,
          },
        },
      };
      
      for (let i = 0; i < childNodes.length; i++) {
        const childNode = childNodes[i];
        if (childNode.nodeName.toLowerCase() === "br") {
          continue;
        }
        if (childNode.nodeType === Node.TEXT_NODE) {
          const textContent = browserUtils.getFullTextContent(element);
          // Preserve prior behavior: attach text to the element (or to the br-wrapper childJSON)
          browserUtils.handleTextNode(textContent, childJSON, childJSON?.props?.text?.staticString);
          if (childNodes[i+1]?.nodeType !== Node.TEXT_NODE && childNodes[i+1]?.nodeName.toLowerCase() !== "br") {
            children.push(childJSON);
          }
          elementJSON.type = "box";
        } else if (childNode.nodeType === Node.ELEMENT_NODE) {
          const childJSON = await convertHTMLToComposableJSON(childNode, componentMappings, designTokens);
          if (childJSON) {
            children.push(childJSON);
          }
        }
      }
    } else {
      // Handle RTE components (backend logic)
      if (HTML_RTE_COMPONENTS.includes(componentName) && childNodes.length) {
        elementJSON.props.html = {
          type: 'string',
          staticString: element.innerHTML
        };
        return elementJSON;
      }

      // Handle SVG (backend logic)
      if (element.tagName.toLowerCase() === "svg") {
        elementJSON.props.src = {
          type: "imageUrl",
          staticString: await browserUtils.convertSVGToBase64(element),
        };
        return elementJSON;
      }

      // Handle button (backend logic)
      if (element.tagName.toLowerCase() === "button") {
        const textContent = browserUtils.getFullTextContent(element);
        browserUtils.handleButtonElement(textContent, elementJSON);
      }

      // Handle link elements (backend logic)
      if (element.tagName.toLowerCase() === "a") {
        browserUtils.handleLinkElement(element, elementJSON);
      }

      // Handle form elements (backend logic)
      browserUtils.handleFormElement(element, elementJSON);

      // Handle media tags (backend logic)
      if (MEDIA_TAGS.includes(element.tagName)) {
        browserUtils.handleImageElement(element, elementJSON);
        browserUtils.handleVideoElement(element, elementJSON);
        return elementJSON;
      }

      // Process child nodes (backend logic)
      for (let i = 0; i < childNodes.length; i++) {
        const childNode = childNodes[i];
        if (childNode.nodeType === Node.TEXT_NODE) {
          // Skip text processing for link elements since handleLinkElement already sets props.label
          if (element.tagName.toLowerCase() !== "a") {
            const textContent = browserUtils.getFullTextContent(element);
            browserUtils.handleTextNode(textContent, elementJSON);
          }
        } else if (childNode.nodeType === Node.ELEMENT_NODE) {
          const childJSON = await convertHTMLToComposableJSON(childNode, componentMappings, designTokens);
          if (childJSON) {
            children.push(childJSON);
          }
        }
      }
    }

    // Add children to slots (backend logic)
    if (children.length) {
      elementJSON.props.children = {
        type: "slot",
        slot: uid,
      };
      elementJSON.slots = {
        ...elementJSON.slots,
        [uid]: children,
      };
    }
  }

  return elementJSON;
}

/**
 * Convert the current page to Composable JSON
 */
async function convertPageToJSON(options = {}) {
  console.log('🚀 Starting advanced browser-based HTML to JSON conversion...');
  
  const startTime = performance.now();
  
  try {
    const body = document.body;
    if (!body) {
      throw new Error('No body element found');
    }

    //console.log('📄 Converting DOM to JSON using backend logic...');
    
    const result = await convertHTMLToComposableJSON(
      body, 
      options.componentMappings || [], 
      options.designTokens || {}
    );
    
    if (!result) {
      throw new Error('Failed to convert body element');
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    console.log(`✅ Conversion completed in ${duration}ms`);
    // console.log('📊 Result structure:', {
    //   type: result.type,
    //   uid: result.uid,
    //   childrenCount: result.slots ? Object.keys(result.slots).length : 0
    // });
    
    return result;
    
  } catch (error) {
    console.error('❌ Conversion failed:', error);
    throw error;
  }
}

/**
 * Download the JSON result as a file
 */
function downloadJSON(jsonData, filename = 'page-conversion.json') {
  const dataStr = JSON.stringify(jsonData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(dataBlob);
  link.download = filename;
  link.click();
  
  //TODO: remove this
  console.log(`📥 Downloaded: ${filename}`);
}

/**
 * Convert and download the page JSON
 */
async function convertAndDownload(options = {}) {
  try {
    const result = await convertPageToJSON(options);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Extract page route for dynamic filename
    const pageRoute = getPageRoute();
    const filename = `${pageRoute}-${timestamp}.json`;
    
    downloadJSON(result, filename);
    return result;
  } catch (error) {
    console.error('❌ Convert and download failed:', error);
  }
}

/**
 * Extract page route for filename
 */
function getPageRoute() {
  try {
    const url = window.location.href;
    const urlObj = new URL(url);
    
    // Get hostname and port
    const hostname = urlObj.hostname;
    const port = urlObj.port;
    
    // Create hostname + port prefix
    let hostPrefix = hostname;
    if (port) {
      hostPrefix = `${hostname}_${port}`;
    }
    
    // Get pathname and clean it up
    let pathname = urlObj.pathname;
    
    //console.log('🔍 Original pathname:', pathname);
    
    // Remove leading and trailing slashes
    pathname = pathname.replace(/^\/+|\/+$/g, '');
    
    //console.log('🔍 After removing slashes:', pathname);
    
    // If pathname is empty (root path), use 'root'
    if (!pathname || pathname === '' || pathname.length === 0) {
      pathname = 'root';
    }
    
    // Combine hostname + port with pathname
    const fullRoute = `${hostPrefix}_${pathname}`;
    
    // Replace underscores and spaces with hyphens (but keep the hostname underscores)
    let cleanRoute = fullRoute.replace(/[_\s]+/g, '_');
    
    // Remove any special characters except underscores and hyphens
    cleanRoute = cleanRoute.replace(/[^a-zA-Z0-9_\-]/g, '');
    
    // Ensure it starts with a letter
    if (/^\d/.test(cleanRoute)) {
      cleanRoute = 'page_' + cleanRoute;
    }
    
    //console.log('🔍 Final route name:', cleanRoute);
    return cleanRoute;
    
  } catch (error) {
    console.error('Error extracting page route:', error);
    return 'page-conversion';
  }
}

// Export functions
window.BrowserConverterAdvanced = {
  convertPageToJSON,
  downloadJSON,
  convertAndDownload,
  utils: browserUtils
};

/**
 * Convert and send JSON data to parent window (Studio)
 */
async function convertAndSendToStudio(options = {}, targetOrigin = '*') {
  try {
    //console.log('🔄 Converting page for Studio...');
    const result = await convertPageToJSON(options);
    
    // Store the result locally
    lastConversionResult = result;
    
    // TODO: Temporary debug aid — also download the JSON we send to Studio.
    // Remove try catch below once comparison is completed.
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const pageRoute = getPageRoute();
      const debugFilename = `${pageRoute}-${timestamp}-studio.json`;
      downloadJSON(result, debugFilename);
    } catch (e) {
      console.warn('JSON debug download failed:', e);
    }
    
    // Send to parent window (Studio)
    window.parent.postMessage({
      type: 'html-to-json-response',
      data: result
    }, targetOrigin || '*');
    
    //console.log('📤 Sent JSON data to Studio');
    return result;
  } catch (error) {
    console.error('❌ Convert and send failed:', error);
    
    // Send error to Studio
    window.parent.postMessage({
      type: 'html-to-json-error',
      error: error.message
    }, targetOrigin || '*');
  }
}

/**
 * Listen for requests from Studio
 */
window.addEventListener('message', (event) => {
  // Only accept messages from Studio (localhost:5174)
  if (event.origin !== 'http://localhost:5174' && event.origin !== 'http://localhost:5173') {
    return;
  }
  
  if (event.data.type === 'request-html-to-json') {
    console.log('🔄 Received request for HTML to JSON conversion');
    
    // If we have a cached result, send it immediately
    if (lastConversionResult) {
      window.parent.postMessage({
        type: 'html-to-json-response',
        data: lastConversionResult
      }, event.origin);
    } else {
      // Convert fresh
      convertAndSendToStudio(event.data.options || {}, event.origin);
    }
  }
});
