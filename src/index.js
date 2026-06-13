const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createObjectCsvWriter } = require("csv-writer");

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

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
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
    `udemy_courses_${getTodayString()}.csv`
  );

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
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

  await csvWriter.writeRecords(results);

  return outputPath;
}

async function main() {
  console.log(`Found ${urls.length} URL(s)`);

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  const results = [];

  for (const url of urls) {
    try {
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
    }
  }

  await browser.close();

  const outputPath = await writeCsv(results);

  console.log(`CSV saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
