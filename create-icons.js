const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function createIcons() {
  const svgPath = path.join(__dirname, "build", "icon.svg");
  const buildDir = path.join(__dirname, "build");

  if (!fs.existsSync(svgPath)) {
    console.error("SVG icon not found at:", svgPath);
    return;
  }

  // macOS icon sizes
  const iconSizes = [16, 32, 64, 128, 256, 512, 1024];

  console.log("Creating PNG icons from SVG...");

  for (const size of iconSizes) {
    const outputPath = path.join(buildDir, `icon_${size}x${size}.png`);

    try {
      await sharp(svgPath).resize(size, size).png().toFile(outputPath);

      console.log(`✓ Created ${size}x${size} icon`);
    } catch (error) {
      console.error(`✗ Failed to create ${size}x${size} icon:`, error.message);
    }
  }

  // Create the main icon.png (512x512)
  try {
    await sharp(svgPath)
      .resize(512, 512)
      .png()
      .toFile(path.join(buildDir, "icon.png"));

    console.log("✓ Created main icon.png (512x512)");
  } catch (error) {
    console.error("✗ Failed to create main icon.png:", error.message);
  }

  // Create icon.icns for macOS (combine multiple sizes)
  try {
    await sharp(svgPath)
      .resize(1024, 1024)
      .png()
      .toFile(path.join(buildDir, "icon.icns"));

    console.log("✓ Created icon.icns (1024x1024)");
  } catch (error) {
    console.error("✗ Failed to create icon.icns:", error.message);
  }

  console.log("Icon creation complete!");
}

createIcons().catch(console.error);
