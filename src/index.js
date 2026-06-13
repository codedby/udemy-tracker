const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createObjectCsvStringifier } = require("csv-writer");

const urls = fs
  .readFileSync("urls.txt", "utf-8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

function firstItem(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getNameList(value) {
  if (!value) return "";
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => item.name).filter(Boolean).join(", ");
}

function parseIsoDuration(duration) {
  if (!duration) return "";

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return duration;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);

  return Math.round((hours + minutes / 60) * 100) / 100;
}

function parseStudentCount(pageText) {
  const match = pageText.match(/([\d,\.]+)\s+students/i);

  if (!match) return "";

  return Number(match[1].replace(/[,.]/g, ""));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getTimestampString() {
  const now = new Date();

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());

  return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeCourse(page, courseUrl) {
  console.log("Opening:", courseUrl);

  await page.goto(courseUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const structuredDataText = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();

  const structuredData = JSON.parse(structuredDataText);

  const graph = structuredData["@graph"] || [];
  const course = graph.find((item) => item["@type"] === "Course");

  if (!course) {
    throw new Error("Course structured data not found");
  }

  const courseInstance = firstItem(course.hasCourseInstance);
  const aggregateRating = course.aggregateRating || {};
  const pageText = await page.locator("body").innerText();

  return {
    course_url: courseUrl,
    title: course.name || "",
    instructor: getNameList(course.author),
    rating: aggregateRating.ratingValue || "",
    reviews_count: aggregateRating.reviewCount || "",
    students_count: parseStudentCount(pageText),
    duration_hours: parseIsoDuration(courseInstance?.courseWorkload),
    language: course.inLanguage || "",
    date_published: course.datePublished || "",
    scraped_at: new Date().toISOString(),
    status: "success",
    error: "",
  };
}

async function writeCsv(results) {
  fs.mkdirSync("output", { recursive: true });

  const outputPath = path.join(
    "output",
    `udemy_courses_${getTimestampString()}.csv`
  );

  const csvStringifier = createObjectCsvStringifier({
    header: [
      { id: "course_url", title: "course_url" },
      { id: "title", title: "title" },
      { id: "instructor", title: "instructor" },
      { id: "rating", title: "rating" },
      { id: "reviews_count", title: "reviews_count" },
      { id: "students_count", title: "students_count" },
      { id: "duration_hours", title: "duration_hours" },
      { id: "language", title: "language" },
      { id: "date_published", title: "date_published" },
      { id: "scraped_at", title: "scraped_at" },
      { id: "status", title: "status" },
      { id: "error", title: "error" },
    ],
  });

  const csvContent =
    "\uFEFF" +
    csvStringifier.getHeaderString() +
    csvStringifier.stringifyRecords(results);

  fs.writeFileSync(outputPath, csvContent, "utf8");

  return outputPath;
}

async function main() {
  console.log(`Found ${urls.length} URL(s)`);

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (i > 0) {
      console.log("Waiting 45 seconds before next course...");
      await sleep(45000);
    }

    let browser;

    try {
      browser = await chromium.launch({
        headless: false,
      });

      const page = await browser.newPage();

      const result = await scrapeCourse(page, url);
      results.push(result);

      console.log("Success:", result.title);
    } catch (error) {
      console.error("Failed:", url);
      console.error(error.message);

      results.push({
        course_url: url,
        title: "",
        instructor: "",
        rating: "",
        reviews_count: "",
        students_count: "",
        duration_hours: "",
        language: "",
        date_published: "",
        scraped_at: new Date().toISOString(),
        status: "failed",
        error: error.message,
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  const outputPath = await writeCsv(results);

  console.log(`CSV saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
