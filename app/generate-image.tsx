import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

interface SearchCasterProfile {
  body?: {
    avatarUrl?: string;
  };
}

export async function generateImage(validMessage: any): Promise<string | null> {
  // Log the fid to verify it's correctly extracted
  const fid = validMessage?.data.fid;
  console.log(`Fetching profile for fid: ${fid}`);

  // Return a different PNG when fid is null
  if (!fid) {
    console.error('FID is undefined or null. Returning fallback image.');
    return getFallbackImageBase64();
  }

  const fetchData = async (): Promise<string | null> => {
    try {
      const response = await fetch(`https://searchcaster.xyz/api/profiles?fid=${fid}`);
      if (!response.ok) throw new Error(`Failed to fetch profile for fid ${fid}: HTTP status ${response.status}`);

      const searchcasterData: SearchCasterProfile[] = await response.json() as SearchCasterProfile[];

      if (!Array.isArray(searchcasterData) || searchcasterData.length === 0) {
        console.error('User not found');
        return null;
      }

      const avatarUrl = searchcasterData[0]?.body?.avatarUrl;
      if (!avatarUrl) {
        console.error('Avatar URL not found');
        return null;
      }

      // Fetch avatar with retry on rate limit error (429)
      const avatarBuffer = await fetchWithRetry(`https://res.cloudinary.com/merkle-manufactory/image/fetch/c_fill,f_jpg,w_500/${avatarUrl}`);
      const { data, info } = await sharp(avatarBuffer).raw().toBuffer({ resolveWithObject: true });

      if (!data) {
        console.error('Failed to process image data');
        return null;
      }

      const gridSizeX = 12;
      const gridSizeY = 12;
      const cellWidth = Math.floor(info.width / gridSizeX);
      const cellHeight = Math.floor(info.height / gridSizeY);

      const palette: number[][] = [];

      for (let y = 0; y < gridSizeY; y++) {
        for (let x = 0; x < gridSizeX; x++) {
          const startX = x * cellWidth;
          const startY = y * cellHeight;
          const dominantColor = getDominantColorInGrid(data, startX, startY, cellWidth, cellHeight, info.width);
          palette.push(dominantColor);
        }
      }

       // x is column and y is row (diff than usual)
       const coordinatesTable = [
        { x: 0, y: 0 }, // BG 
        { x: 5, y: 11 }, // torso 
        { x: 6, y: 6}, // mouth bottom 
        { x: 6, y: 8}, // mouth top 
        { x: 5, y: 4 }, // left eye - left bottom 
        { x: 6, y: 4 }, // left eye - right bottom
        { x: 8, y: 4 }, // right eye - left bottom 
        { x: 9, y: 4 }, // right eye - right bottom 
        { x: 9, y: 3 }, // right eye - right top 
        { x: 5, y: 3 }, // left eye - left top 
        { x: 6, y: 3 }, // left eye - right top 
      ];

      const pathColorIndices = coordinatesTable.map(({ x, y }) => x + y * gridSizeX);
      const fidNumber = Number(fid);

      const svgStringWithColors = constructSvgStringWithColors(palette, pathColorIndices, fidNumber);

      const pngBuffer = await sharp(Buffer.from(svgStringWithColors)).png().toBuffer();
      return pngBuffer.toString('base64');

    } catch (error) {
      console.error('Error fetching data:', error);
      return null;
    }
  };

  return await fetchData();
}

async function fetchWithRetry(url: string, retries = 3, backoff = 300) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.buffer();
    } else if (response.status === 429 && retries > 0) {
      console.log(`Rate limited. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, retries - 1, backoff * 2); // Exponential backoff
    } else {
      throw new Error(`Failed to fetch: HTTP status ${response.status}`);
    }
  } catch (error) {
    console.error('Fetch error:', error);
    if (retries > 0) {
      console.log(`Retrying... ${retries} retries left`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, retries - 1, backoff * 2);
    }
    throw error; // Rethrow error if retries are exhausted
  }
}

function getDominantColorInGrid(data: Buffer | undefined, startX: number, startY: number, cellWidth: number, cellHeight: number, width: number): number[] {
  // Initialize sum variables
  let sumRed = 0, sumGreen = 0, sumBlue = 0;

  // Check if data is defined
  if (!data) {
    console.error('Image data is undefined');
    return [0, 0, 0]; // Return a default color or handle the error as appropriate
  }

  const totalPixels = cellWidth * cellHeight;

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const pixelIndex = ((startY + y) * width + (startX + x)) * 3;
      sumRed += data?.[pixelIndex] ?? 0;
      sumGreen += data?.[pixelIndex + 1] ?? 0;
      sumBlue += data?.[pixelIndex + 2] ?? 0;
    }
  }

  const avgRed = Math.round(sumRed / totalPixels);
  const avgGreen = Math.round(sumGreen / totalPixels);
  const avgBlue = Math.round(sumBlue / totalPixels);

  return [avgRed, avgGreen, avgBlue];
}

async function getFallbackImageBase64(): Promise<string | null> {
  const imagePath = path.join(__dirname, 'public', 'fc_opepen.png'); // Adjust the path as necessary
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error('Error reading fallback image:', error);
    return null; // This is now valid due to the function return type being `Promise<string | null>`
  }
}

function getColorForFid(fid: number): string {
  if (fid < 1000) return '#FFD700';
  else if (fid < 10000) return '#855DCD';
  else return 'white'; // Default color
}


function constructSvgStringWithColors(palette: number[][], pathColorIndices: number[], fid: number): string {
  // Start constructing the SVG string
  const svgHeader = `<svg id="abstractSvg" width="1000" height="1000" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`;
  const svgFooter = `</svg>`;

  // Determine the color for the farcheck based on fid
  const farcheckColor = getColorForFid(fid);

  const farcheck = `<path d="M789.644 215.244C781.913 215.244 774.198 215.244 766.467 215.244C766.451 214.342 766.404 213.44 766.451 212.522C766.498 211.62 767.12 210.936 768.007 210.718C768.287 210.656 768.567 210.609 768.909 210.547C768.909 210.002 768.909 209.458 768.909 208.913C768.909 206.969 769.142 206.642 770.916 205.973C770.916 193.731 770.916 181.489 770.916 169.2C770.138 169.2 769.422 169.2 768.691 169.2C768.504 168.578 768.349 168.018 768.162 167.442C767.447 165.078 766.716 162.698 766 160.333C766 160.287 766 160.224 766 160.178C766.311 160.162 766.622 160.131 766.933 160.131C770.324 160.131 773.7 160.131 777.091 160.131C777.371 160.131 777.651 160.131 777.993 160.131C777.993 157.036 777.993 154.018 777.993 151C793.082 151 808.171 151 823.244 151C823.213 151.124 823.167 151.249 823.167 151.373C823.167 154.111 823.167 156.864 823.167 159.602C823.167 159.742 823.213 159.898 823.26 160.116C824.256 160.116 825.236 160.116 826.216 160.116C829.482 160.131 832.733 160.147 836 160.162C836 160.209 836 160.271 836 160.318C835.689 161.298 835.362 162.278 835.067 163.258C834.476 165.233 833.9 167.209 833.293 169.216C832.516 169.216 831.8 169.216 831.053 169.216C831.053 181.52 831.053 193.762 831.053 205.989C832.687 206.44 833.076 206.969 833.091 208.664C833.091 209.287 833.091 209.893 833.091 210.531C833.324 210.562 833.464 210.593 833.62 210.624C834.942 210.842 835.564 211.542 835.58 212.896C835.58 213.673 835.549 214.451 835.533 215.229C827.802 215.229 820.087 215.229 812.356 215.229C812.371 214.731 812.371 214.249 812.387 213.751C812.387 213.331 812.356 212.911 812.402 212.507C812.527 211.371 813.149 210.873 814.876 210.516C814.876 209.753 814.876 208.991 814.876 208.213C814.876 207.404 815.202 206.689 815.933 206.378C816.54 206.129 816.556 205.74 816.54 205.227C816.524 199.3 816.556 193.373 816.524 187.431C816.524 186.404 816.431 185.362 816.244 184.351C814.767 176.122 807.362 170.631 798.822 171.378C790.936 172.078 784.651 179.093 784.651 187.213C784.651 193.171 784.651 199.129 784.651 205.087C784.651 205.398 784.651 205.693 784.651 205.989C786.564 206.238 787.124 206.876 787.124 208.742C787.124 209.333 787.124 209.924 787.124 210.5C789.287 210.967 789.613 211.371 789.613 213.58C789.613 214.156 789.629 214.7 789.644 215.244Z" fill="${farcheckColor}" />`;

  const svgPaths = [
    '<rect id="path1" width="1000" height="1000" fill="COLOR" />', //BG
    '<path id="path2" d="M225 999.5C225 923.561 286.561 862 362.5 862H637.5C713.439 862 775 923.561 775 999.5V999.5H225V999.5Z" fill="COLOR" />',
    '<path id="path3 - mouth bottom" d="M775 627.5C775 703.439 713.439 765 637.5 765L362.5 765C286.561 765 225 703.439 225 627.5V627.5L775 627.5V627.5Z" fill="COLOR" />',
    '<path id="path4 - mouth top" d="M775 627.5L225 627.5V490L775 490V627.5Z" fill="COLOR"/>',
    '<path id="path5 - left eye left bottom" d="M225 352.5H362.5V490V490C286.561 490 225 428.439 225 352.5V352.5Z" fill="COLOR"/>',
    '<path id="path6 - left eye right bottom" d="M362.5 352.5H500V352.5C500 428.439 438.439 490 362.5 490V490V352.5Z" fill="COLOR" />',
    '<path id="path7 - right eye left bottom" d="M500 352.5H637.5V490V490C561.561 490 500 428.439 500 352.5V352.5Z" fill="COLOR" />',
    '<path id="path8 - right eye right bottom" d="M637.5 352.5H775V352.5C775 428.439 713.439 490 637.5 490V490V352.5Z" fill="COLOR" />',
    '<rect id="path9 - right eye right top" x="225" y="215" width="137.5" height="137.5" fill="COLOR" />',
    '<path id="path10  - right eye left top" d="M362.5 215V215C438.439 215 500 276.561 500 352.5V352.5H362.5V215Z" fill="COLOR" />',
    '<path id="path11 - left eye left top" d="M500 352.5C500 276.561 561.561 215 637.5 215V215V352.5H500V352.5Z" fill="COLOR" />',
    '<path id="path12 left eye right top" d="M637.5 215V215C713.439 215 775 276.561 775 352.5V352.5H637.5V215Z" fill="COLOR" />',
    
  

  ];

  const svgBody = svgPaths.map((path, index) => {
    // Check if the current index is within the bounds of pathColorIndices
    if (index < pathColorIndices.length) {
      const colorIndex = pathColorIndices[index];

      // Check if colorIndex is defined and within the bounds of palette
      if (colorIndex !== undefined && colorIndex >= 0 && colorIndex < palette.length) {
        const color = palette[colorIndex];

        // Assuming color is always defined in this context
        const [r, g, b] = color ?? [0, 0, 0];
        const rgbColor = `rgb(${r}, ${g}, ${b})`;
        return path.replace('COLOR', rgbColor);
      }
    }
    return path; // Return the original path if no valid colorIndex found
  }).join('');

  return `${svgHeader}${svgBody}${farcheck}${svgFooter}`;
}