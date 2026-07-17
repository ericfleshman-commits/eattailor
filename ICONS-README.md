# App Icons Needed

## Required Icons for PWA

You need to create the following PNG icon files:

- `icon-192.png` - 192x192 pixels
- `icon-512.png` - 512x512 pixels

## Temporary Solution

Currently, the app uses a placeholder SVG icon (`icon.svg`).

To create proper PNG icons:

1. **Option 1: Use a design tool**
   - Open `icon.svg` in Figma, Adobe Illustrator, or Inkscape
   - Export as PNG at 192x192 and 512x512
   - Save as `icon-192.png` and `icon-512.png`

2. **Option 2: Use an online converter**
   - Go to https://cloudconvert.com/svg-to-png
   - Upload `icon.svg`
   - Convert to PNG at 192x192 and 512x512 sizes
   - Download and rename appropriately

3. **Option 3: Use a PWA icon generator**
   - Go to https://www.pwabuilder.com/imageGenerator
   - Upload a square image (at least 512x512)
   - Download the generated icon pack
   - Copy `icon-192.png` and `icon-512.png` to this directory

## Design Guidelines

- Use a **blue circle** (#4da3ff) as the background
- Add **"NT"** text in white or a contrasting color
- Keep it simple and recognizable at small sizes
- Ensure the icon is **square** (1:1 aspect ratio)
- Use **rounded corners** for iOS compatibility

## Current Placeholder

The placeholder `icon.svg` shows:
- Blue background (#4da3ff)
- White circle in the center
- "NT" text in blue

Replace this with your final icon design!
