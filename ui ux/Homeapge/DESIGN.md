---
name: Luxe & Softness
colors:
  surface: '#fbf8ff'
  surface-dim: '#d5d8f9'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2ff'
  surface-container: '#ececff'
  surface-container-high: '#e5e6ff'
  surface-container-highest: '#dee0ff'
  on-surface: '#161a32'
  on-surface-variant: '#50453b'
  inverse-surface: '#2b2f48'
  inverse-on-surface: '#f0efff'
  outline: '#82756a'
  outline-variant: '#d4c4b7'
  surface-tint: '#7d562d'
  primary: '#7d562d'
  on-primary: '#ffffff'
  primary-container: '#d4a373'
  on-primary-container: '#5b3912'
  inverse-primary: '#f0bd8b'
  secondary: '#745662'
  on-secondary: '#ffffff'
  secondary-container: '#fdd5e4'
  on-secondary-container: '#795a67'
  tertiary: '#3e6750'
  on-tertiary: '#ffffff'
  tertiary-container: '#8bb69b'
  on-tertiary-container: '#1f4833'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcbd'
  primary-fixed-dim: '#f0bd8b'
  on-primary-fixed: '#2c1600'
  on-primary-fixed-variant: '#623f18'
  secondary-fixed: '#ffd8e7'
  secondary-fixed-dim: '#e3bccb'
  on-secondary-fixed: '#2b141f'
  on-secondary-fixed-variant: '#5b3f4b'
  tertiary-fixed: '#c0edd0'
  tertiary-fixed-dim: '#a4d1b4'
  on-tertiary-fixed: '#002112'
  on-tertiary-fixed-variant: '#264f39'
  background: '#fbf8ff'
  on-background: '#161a32'
  surface-variant: '#dee0ff'
typography:
  headline-xl:
    fontFamily: Playfair Display
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.01em
  headline-xl-mobile:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Playfair Display
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Quicksand
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 28px
  body-md:
    fontFamily: Quicksand
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  label-md:
    fontFamily: Quicksand
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Quicksand
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-margin: 24px
  gutter: 16px
  section-gap: 64px
---

## Brand & Style
This design system bridges the gap between high-end luxury and approachable "cuteness." The brand personality is "Affectionate Sophistication"—it feels expensive and exclusive, yet warm, soft, and inviting. It targets a premium audience that values emotional resonance and aesthetic comfort over cold minimalism.

The visual style is a hybrid of **Minimalism** and **Glassmorphism**. It utilizes expansive white space and a restricted palette, but softens every edge with generous rounding and translucent, frosted layers. The goal is to evoke the feeling of a high-end boutique that is unexpectedly cozy and sweet.

## Colors
The palette is rooted in "Champagne Gold" (Primary) to maintain luxury status, supported by "Petal Pink" (Secondary) to inject the requested "cute" and "sweet" personality. 

- **Primary:** A refined, muted gold for core branding and primary actions.
- **Secondary:** A soft, powdery pink used for accents, highlights, and "soft" interactions.
- **Tertiary:** A desaturated mint for subtle success states or secondary accents.
- **Neutral:** A warm, deep charcoal-purple for typography to avoid the harshness of pure black, maintaining a "soft" reading experience.
- **Backgrounds:** Use extremely high-key off-whites and very faint pink tints to keep the interface feeling airy.

## Typography
The typographic strategy pairs the high-contrast elegance of **Playfair Display** with the friendly, rounded terminals of **Quicksand**. 

- **Headlines:** Set in Playfair Display. To maximize the "cute" yet premium feel, use Title Case for headers and keep weights slightly heavier to emphasize the elegant curves of the serif.
- **Body & UI:** Set in Quicksand. The rounded nature of this font provides the "sweet" personality requested. Use a medium weight (500) as the default for body text to ensure the rounded shapes are legible and prominent.
- **Labels:** Use uppercase Quicksand with increased letter spacing for a "boutique" aesthetic on small tags and buttons.

## Layout & Spacing
The layout follows a **Fluid Grid** model with an emphasis on "breathability." 

- **Desktop:** 12-column grid with wide 32px gutters to prevent elements from feeling cramped.
- **Mobile:** 4-column grid with 24px side margins.
- **Rhythm:** Use a strict 8px baseline. Vertical spacing between sections should be generous (64px+) to maintain a premium, editorial feel. 
- **Alignment:** Center-alignment is preferred for hero sections and splash pages to emphasize the "boutique" character.

## Elevation & Depth
Depth is achieved through **Glassmorphism** and "Cloud Shadows."

- **Layers:** Use backdrop blurs (20px-30px) on navigation bars and floating modals to create a sense of lightness and transparency.
- **Shadows:** Avoid dark, sharp shadows. Use "Cloud Shadows"—extremely diffused (blur 40px+), low opacity (5-10%), and tinted with the secondary pink or primary gold hex rather than pure grey.
- **Surfaces:** Containers should use a subtle semi-transparent white (rgba 255, 255, 255, 0.8) to allow background colors to bleed through softly.

## Shapes
Shapes are fundamentally **Rounded**. This is the primary driver of the "cute" and "approachable" feel.

- **Standard Elements:** Buttons and input fields use a 0.5rem (8px) radius.
- **Large Elements:** Cards and containers use a 1rem (16px) radius.
- **Special Accents:** Use "Squircle" shapes for profile pictures or featured icons to further differentiate from standard geometric rounding and lean into the premium-soft aesthetic.

## Components
- **Buttons:** Use high-contrast Primary Gold for main actions. The text should be Quicksand Bold. Include a subtle "squish" scale animation (scale 0.98) on click to enhance the tactile, friendly feel.
- **Chips:** Soft Petal Pink backgrounds with deep charcoal-purple text. Use pill-shaped (fully rounded) corners for these smaller elements.
- **Input Fields:** Use a soft-grey border (1px) that transitions to Primary Gold on focus. The background should be a very faint tint of the secondary color.
- **Cards:** Cards should have no border, relying instead on the "Cloud Shadows" and a subtle backdrop blur.
- **Checkboxes/Radios:** Replace sharp corners with soft rounding even on checkboxes. Use a custom "heart" or "star" subtle micro-interaction for successful selections where appropriate to the context.
- **Lists:** Use generous vertical padding (16px) between items and separate them with very faint, partial-width dividers.