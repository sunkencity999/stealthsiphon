const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pngToIco = require('png-to-ico');

// Convert SVG to PNG using svg2png-cli
try {
  console.log('Converting SVG to PNG...');
  execSync('npx svg2png-cli -i favicon.svg -o favicon.png -w 256 -h 256');
  console.log('SVG to PNG conversion successful!');
  
  // Convert PNG to ICO
  console.log('Converting PNG to ICO...');
  pngToIco([path.join(__dirname, 'favicon.png')])
    .then(buf => {
      fs.writeFileSync(path.join(__dirname, 'favicon.ico'), buf);
      console.log('PNG to ICO conversion successful!');
      console.log('favicon.ico created successfully!');
    })
    .catch(err => {
      console.error('Error converting PNG to ICO:', err);
    });
} catch (error) {
  console.error('Error converting SVG to PNG:', error.message);
}
