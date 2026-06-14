const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createObjectCsvStringifier } = require("csv-writer");

function normalizeCourseUrl(url) {
  try {
    const parsedUrl = new URL(url.trim());

    parsedUrl.hash = "";
    parsedUrl.search = "";

    let normalizedUrl = parsedUrl.toString();

    if (!normalizedUrl.endsWith("/")) {
      normalizedUrl += "/";
    }

    return normalizedUrl;
  } catch {
    return url.trim();
  }
}

const rawUrls = fs
  .readFileSync("urls.txt", "utf-8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const urls = [...new Set(rawUrls.map(normalizeCourseUrl))];

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

function extractInstructorIdFromHtml(html) {
  const patterns = [
    /"instructors"\s*:\s*\[\s*\{\s*"id"\s*:\s*"(\d+)"/,
    /\\"instructors\\"\s*:\s*\[\s*\{\s*\\"id\\"\s*:\s*\\"(\d+)\\"/,
    /"owner"\s*:\s*\{\s*"id"\s*:\s*"(\d+)"/,
    /\\"owner\\"\s*:\s*\{\s*\\"id\\"\s*:\s*\\"(\d+)\\"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function stripHtml(html) {
  if (!html) return "";

  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInstructorApiUrl(instructorId) {
  return (
    `https://www.udemy.com/api-2.0/users/${instructorId}/taught-courses/?` +
    "page=1" +
    "&page_size=4" +
    "&organizationCoursesOnly=false" +
    "&filter_hq_courses=true" +
    "&ordering=lang%2C-course_performance__revenue_30days" +
    "&fields%5Bcourse%5D=id%2Ctitle%2Curl%2Cheadline%2Cavg_rating%2Cnum_reviews%2Cestimated_content_length%2Clast_update_date%2Cvisible_instructors" +
    "&fields%5Buser%5D=id%2Ctitle%2Cname%2Cdisplay_name%2Cjob_title%2Curl%2Cdescription%2Cavg_rating%2Cavg_rating_recent%2Ctotal_num_reviews%2Ctotal_num_students%2Cnum_published_courses%2Cnum_visible_taught_courses"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function createOutputPath() {
  fs.mkdirSync("output", { recursive: true });

  return path.join(
    "output",
    `udemy_courses_${getTimestampString()}.csv`
  );
}

function createCsvStringifier() {
  return createObjectCsvStringifier({
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
      { id: "instructor_id", title: "instructor_id" },
      { id: "instructor_name", title: "instructor_name" },
      { id: "instructor_job_title", title: "instructor_job_title" },
      { id: "instructor_url", title: "instructor_url" },
      { id: "instructor_rating", title: "instructor_rating" },
      { id: "instructor_recent_rating", title: "instructor_recent_rating" },
      { id: "instructor_total_students", title: "instructor_total_students" },
      { id: "instructor_total_courses", title: "instructor_total_courses" },
      {
        id: "instructor_visible_taught_courses",
        title: "instructor_visible_taught_courses",
      },
      { id: "instructor_total_reviews", title: "instructor_total_reviews" },
      { id: "instructor_about", title: "instructor_about" },
      { id: "scraped_at", title: "scraped_at" },
      { id: "status", title: "status" },
      { id: "error", title: "error" },
    ],
  });
}

function appendRowToCsv(outputPath, csvStringifier, row) {
  const csvRow = csvStringifier.stringifyRecords([row]);
  fs.appendFileSync(outputPath, csvRow, "utf8");
}

async function scrapeCourse(courseUrl) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: false,
    });

    const page = await browser.newPage();

    console.log("Opening course:", courseUrl);

    await page.goto(courseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

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
    const html = await page.content();
    const instructorId = extractInstructorIdFromHtml(html);

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
      instructor_id: instructorId,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function scrapeInstructor(instructorId) {
  if (!instructorId) {
    return {};
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: false,
    });

    const page = await browser.newPage();
    const apiUrl = buildInstructorApiUrl(instructorId);

    console.log("Opening instructor API:", instructorId);

    const response = await page.goto(apiUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const status = response.status();

    if (status !== 200) {
      throw new Error(`Instructor API returned status ${status}`);
    }

    const bodyText = await page.locator("body").innerText();
    const data = JSON.parse(bodyText);

    const firstCourse = data.results?.[0];
    const instructor = firstCourse?.visible_instructors?.[0];

    if (!instructor) {
      throw new Error("Instructor data not found in API response");
    }

    return {
      instructor_name: instructor.display_name || instructor.title || instructor.name || "",
      instructor_job_title: instructor.job_title || "",
      instructor_url: instructor.url || "",
      instructor_rating: instructor.avg_rating || "",
      instructor_recent_rating: instructor.avg_rating_recent || "",
      instructor_total_students: instructor.total_num_students || "",
      instructor_total_courses: instructor.num_published_courses || "",
      instructor_visible_taught_courses: instructor.num_visible_taught_courses || "",
      instructor_total_reviews: instructor.total_num_reviews || "",
      instructor_about: stripHtml(instructor.description || ""),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  console.log(`Found ${rawUrls.length} URL(s), ${urls.length} unique URL(s)`);

  const outputPath = createOutputPath();
  const csvStringifier = createCsvStringifier();

  fs.writeFileSync(outputPath, "\uFEFF" + csvStringifier.getHeaderString(), "utf8");

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (i > 0) {
      console.log("Waiting 45 seconds before next course...");
      await sleep(45000);
    }

    let row;

    try {
      const courseData = await scrapeCourse(url);

      let instructorData = {};

      if (courseData.instructor_id) {
        console.log("Waiting 20 seconds before instructor API...");
        await sleep(20000);
        instructorData = await scrapeInstructor(courseData.instructor_id);
      }

      row = {
        ...courseData,
        ...instructorData,
        scraped_at: new Date().toISOString(),
        status: "success",
        error: "",
      };

      console.log("Success:", row.title);
    } catch (error) {
      console.error("Failed:", url);
      console.error(error.message);

      row = {
        course_url: url,
        title: "",
        instructor: "",
        rating: "",
        reviews_count: "",
        students_count: "",
        duration_hours: "",
        language: "",
        date_published: "",
        instructor_id: "",
        instructor_name: "",
        instructor_job_title: "",
        instructor_url: "",
        instructor_rating: "",
        instructor_recent_rating: "",
        instructor_total_students: "",
        instructor_total_courses: "",
        instructor_visible_taught_courses: "",
        instructor_total_reviews: "",
        instructor_about: "",
        scraped_at: new Date().toISOString(),
        status: "failed",
        error: error.message,
      };
    }

    appendRowToCsv(outputPath, csvStringifier, row);
    console.log("Row saved to CSV");
  }

  console.log(`CSV saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
