# Udemy Tracker

A local Node.js scraper for tracking selected Udemy course performance over time.

The scraper reads course URLs from `urls.txt`, opens each course page with Playwright, extracts available course and instructor data, and saves the results to a timestamped CSV file inside the `output/` folder.

## What it collects

For each course, the scraper currently collects:

- Course URL
- Course title
- Instructor name
- Course rating
- Review count
- Student count
- Course duration
- Course language
- Date published
- Instructor ID
- Instructor job title
- Instructor profile URL
- Instructor rating
- Instructor total students
- Instructor total courses
- Instructor total reviews
- Instructor about text
- Scrape timestamp
- Status
- Error message, if failed

## How to use

### 1. Add course URLs

Create or edit `urls.txt` in the project root.

Example:

```txt
https://www.udemy.com/course/example-course-1/
https://www.udemy.com/course/example-course-2/