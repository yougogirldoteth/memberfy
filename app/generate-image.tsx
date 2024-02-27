import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import kmeans from "kmeans-ts";

interface SearchCasterProfile {
  body?: {
    avatarUrl?: string;
  };
}

export async function generateImage(validMessage: any): Promise<string | null> {
  // Log the fid to verify it's correctly extracted
  const fid = validMessage?.data.fid;
  console.log(`Fetching profile for fid: ${fid}`);

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


      // Fetch avatar
      const avatarBuffer = await fetchWithRetry(`https://res.cloudinary.com/merkle-manufactory/image/fetch/c_fill,f_jpg,w_500/${avatarUrl}`);

      // Pixeling helping with finding dominant color
      const pixelatedBuffer = await sharp(avatarBuffer)
        .resize(25, 25) // Pixelate by resizing down
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { data, info } = pixelatedBuffer;
      if (!data) {
        console.error('Failed to process image data');
        return null;
      }

      // dividing input image into grid
      const gridSizeX = 9;
      const gridSizeY = 9;
      const cellWidth = Math.floor(info.width / gridSizeX);
      const cellHeight = Math.floor(info.height / gridSizeY);

      const palette: number[][] = [];

      for (let y = 0; y < gridSizeY; y++) {
        for (let x = 0; x < gridSizeX; x++) {
          const startX = x * cellWidth;
          const startY = y * cellHeight;
          const dominantColor = getDominantColorInGrid(data, startX, startY, cellWidth, cellHeight, info.width);
          palette.push(await dominantColor);
        }
      }

      // assigning grid cells to svg paths, x is column and y is row 
      const coordinatesTable = [
        { x: 4, y: 4 }, // head
        { x: 5, y: 4 }, // head
        { x: 0, y: 0 }, // changes nothin
        { x: 5, y: 5 }, // noggles
        { x: 4, y: 6 }, // body 1
        { x: 4, y: 7 }, // eye brows
        { x: 0, y: 0 }, // BG
        { x: 1, y: 5 }, // changes nothin
        { x: 4, y: 6 }, // body 2 

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

async function getDominantColorInGrid(data: Buffer, startX: number, startY: number, cellWidth: number, cellHeight: number, width: number): Promise<number[]> {
  const pixels: number[][] = [];
  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const pixelIndex = ((startY + y) * width + (startX + x)) * 3;
      pixels.push([
        data[pixelIndex] ?? 0,     // Red
        data[pixelIndex + 1] ?? 0, // Green
        data[pixelIndex + 2] ?? 0, // Blue
      ]);
    }
  }

  const K = 1;
  const result = await kmeans(pixels, K);

  // Check if centroids are returned, not undefined, and the first element exists
  if (!result.centroids || result.centroids.length === 0 || result.centroids[0] === undefined) {
    throw new Error('No valid centroids returned from kmeans.');
  }

  // Now that we've checked centroids[0] is not undefined, we can safely access it
  const dominantColor = result.centroids[0].map(Math.round);
  return dominantColor;
}

// not used for this project, but could color any path based on fid (farcaster id)
function getColorForFid(fid: number): string {
  if (fid < 1000) return 'gold';
  else if (fid < 10000) return '#855DCD';
  else if (fid < 20000) return '#94E337';
  else return 'white'; // Default color
}

function constructSvgStringWithColors(palette: number[][], pathColorIndices: number[], fid: number): string {
  const svgHeader = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" fill="none">`;
  const svgFooter = `</svg>`;

  // Determine the color for the farcheck based on fid
  // const farcheckColor = getColorForFid(fid)
  // const farcheck = `<path fill-opacity=".9" d="" fill="${farcheckColor}" />`;

  const svgPaths = [
    '<path fill="COLOR" d="M384 256h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-299 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm-342 85h-42v43h42v-43Zm86 0h-43v43h43v-43Zm85 0h-43v43h43v-43Zm85 0h-42v43h42v-43Zm86 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M299 341h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-426 43h-43v43h43v-43Zm85 0h-43v43h43v-43Zm85 0h-42v43h42v-43Zm86 0h-43v43h43v-43Zm85 0h-43v43h43v-43Zm85 0h-42v43h42v-43Z"/>',
    '<path fill="#fff" d="M469 512h-42v43h42v-43Zm214 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M384 427h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm85 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm-426 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm128 0h-42v43h42v-43Zm-426 43h-43v43h43v-43Zm85 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm85 0h-42v43h42v-43Zm128 0h-42v43h42v-43Zm-341 43h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm85 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Z"/>',
    '<path fill="COLOR" d="M341 427h-42v42h42v-42Zm214 0h-43v42h43v-42Zm-214 85h-42v43h42v-43Zm214 0h-43v43h43v-43Zm-214 43h-42v42h42v-42Zm214 0h-43v42h43v-42Zm-214 42h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-299 43h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-256 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Z"/>',
    '<path fill="COLOR" d="M427 469h-43v43h43v-43Zm42 0h-42v43h42v-43Zm171 0h-43v43h43v-43Zm43 0h-43v43h43v-43ZM512 768h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Z"/>',
    '<path fill="COLOR" d="M43 0H0v43h43V0Zm42 0H43v43h42V0Zm43 0H85v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0Zm43 0h-43v43h43V0Zm42 0h-42v43h42V0Zm43 0h-43v43h43V0ZM43 43H0v42h43V43Zm42 0H43v42h42V43Zm43 0H85v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43Zm43 0h-43v42h43V43Zm42 0h-42v42h42V43Zm43 0h-43v42h43V43ZM43 85H0v43h43V85Zm42 0H43v43h42V85Zm43 0H85v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85Zm43 0h-43v43h43V85Zm42 0h-42v43h42V85Zm43 0h-43v43h43V85ZM43 128H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 171H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 213H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm342 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 256H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm426 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 299H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 341H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm598 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 384H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm598 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 427H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 469H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 512H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 555H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 597H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 640H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 683H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 725H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 768H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 811H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 853H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 896H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43ZM43 939H0v42h43v-42Zm42 0H43v42h42v-42Zm43 0H85v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm512 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42ZM43 981H0v43h43v-43Zm42 0H43v43h42v-43Zm43 0H85v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm512 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Z"/>',
    '<path fill="black" d="M384 213h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-299 43h-42v43h42v-43Zm342 0h-43v43h43v-43Zm-384 43h-43v42h43v-42Zm426 0h-42v42h42v-42Zm-469 42h-43v43h43v-43Zm512 0h-43v43h43v-43Zm-512 43h-43v43h43v-43Zm512 0h-43v43h43v-43Zm-469 43h-43v42h43v-42Zm0 128h-43v42h43v-42Zm0 42h-43v43h43v-43Zm426 0h-42v43h42v-43Zm-426 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm384 0h-42v43h42v-43Zm-426 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm299 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm-426 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-426 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm171 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-426 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm-426 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-426 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-426 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm-426 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43ZM555 640h-43v43h43v-43Zm42 0h-42v43h42v-43ZM427 512h-43v43h43v-43Zm213 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M341 597h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm-342 42h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm171 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm-342 42h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-342 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm-342 42h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Z"/>',
    '<path fill="black" d="M555 640h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-85 128h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Z"/>',

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


  return `${svgHeader}${svgBody}${svgFooter}`;
}