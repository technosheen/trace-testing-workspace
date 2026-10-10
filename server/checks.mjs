import { journey } from "./journey.mjs";
import { id } from "./store.mjs";
import { safeNavigation } from "./policy.mjs";

const definitions = [
  [
    "http",
    "Page responds successfully",
    "The target page returns an HTTP status below 400.",
  ],
  [
    "title",
    "Page has a descriptive title",
    "The page has a non-empty document title.",
  ],
  [
    "main",
    "Main content is identifiable",
    "A main element or main landmark is visible.",
  ],
  [
    "heading",
    "Primary heading is present",
    "At least one visible level-one heading introduces the page.",
  ],
  [
    "images",
    "Images have alternative text",
    "Visible meaningful images have text alternatives; explicitly decorative images may have empty alt text.",
  ],
  [
    "labels",
    "Form controls have accessible names",
    "Visible editable controls have a label, title, or ARIA name.",
  ],
  [
    "console",
    "Page loads without JavaScript errors",
    "No uncaught JavaScript errors occur during the observation window.",
  ],
  [
    "links",
    "Internal navigation resolves",
    "Up to five same-origin links without query strings or state-changing path names return a successful response.",
  ],
  [
    "mobile",
    "Mobile layout fits the viewport",
    "At 390px wide, the document has no horizontal overflow greater than 4px.",
  ],
];
export const checkKinds = [...definitions.map((d) => d[0]), "text", "selector"];
export function planCases(mode = "smoke", expectedText = "") {
  let defs = definitions;
  if (mode === "accessibility")
    defs = definitions.filter((d) =>
      ["main", "heading", "images", "labels", "mobile"].includes(d[0]),
    );
  if (mode === "navigation")
    defs = definitions.filter((d) =>
      ["http", "title", "links", "console"].includes(d[0]),
    );
  const cases = defs.map(([kind, name, acceptance]) => ({
    id: id(),
    kind,
    name,
    acceptance,
    preconditions: [
      "Public page reachable without a sign-in.",
      "Read-only check; form submissions are not performed.",
    ],
    steps: [
      "Open the environment URL in an isolated browser.",
      acceptance,
      "Capture the observed result and screenshot.",
    ],
    status: "not_run",
    controls: [],
    evidence: [],
    result: null,
  }));
  if (expectedText)
    cases.push({
      id: id(),
      kind: "text",
      value: expectedText,
      name: `Expected text: ${expectedText}`,
      acceptance: `The visible page contains “${expectedText}”.`,
      preconditions: ["Target page is reachable."],
      steps: ["Open the target.", `Find visible text “${expectedText}”.`],
      status: "not_run",
      controls: [],
      evidence: [],
      result: null,
    });
  return cases;
}
export async function check(page, spec, context) {
  const result = (ok, summary, details = []) => ({
    status: ok ? "passed" : "issues_found",
    summary,
    details,
  });
  switch (spec.kind) {
    case "journey": return journey(page, spec, context);
    case "http":
      return result(
        context.status > 0 && context.status < 400,
        `Document returned HTTP ${context.status || "unknown"}.`,
      );
    case "title": {
      const title = (await page.title()).trim();
      return result(
        Boolean(title),
        title ? `Document title: ${title}` : "The document title is empty.",
      );
    }
    case "main": {
      const count = await page
        .locator('main:visible, [role="main"]:visible')
        .count();
      return result(
        count > 0,
        count
          ? `${count} visible main landmark(s).`
          : "No visible main landmark was found.",
      );
    }
    case "heading": {
      const headings = await page
        .locator('h1:visible, [role="heading"][aria-level="1"]:visible')
        .allTextContents();
      return result(
        headings.some((t) => t.trim()),
        headings.length
          ? `Primary heading: ${headings.join(" · ")}`
          : "No visible primary heading was found.",
      );
    }
    case "images": {
      const missing = await page
        .locator("img:visible")
        .evaluateAll((imgs) =>
          imgs
            .filter(
              (img) =>
                !img.hasAttribute("alt") &&
                !["presentation", "none"].includes(img.getAttribute("role")) &&
                img.getAttribute("aria-hidden") !== "true" &&
                !img.getAttribute("aria-label") &&
                !img.getAttribute("aria-labelledby"),
            )
            .map((img) => img.getAttribute("src") || "(image without source)"),
        );
      return result(
        !missing.length,
        missing.length
          ? `${missing.length} visible image(s) have no text alternative.`
          : "All visible images declare a text alternative or decorative intent.",
        missing,
      );
    }
    case "labels": {
      const missing = await page
        .locator(
          'input:visible:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select:visible, textarea:visible',
        )
        .evaluateAll((els) =>
          els
            .filter(
              (el) =>
                !el.labels?.length &&
                !el.getAttribute("aria-label")?.trim() &&
                !el.getAttribute("title")?.trim() &&
                !(el.getAttribute("aria-labelledby") || "")
                  .split(/\s+/)
                  .some((v) => document.getElementById(v)?.textContent?.trim()),
            )
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.getAttribute("name") ? "[name=" + el.getAttribute("name") + "]" : ""}`,
            ),
        );
      return result(
        !missing.length,
        missing.length
          ? `${missing.length} visible form control(s) lack an accessible name.`
          : "All visible editable controls have accessible names.",
        missing,
      );
    }
    case "console":
      return result(
        !context.errors.length,
        context.errors.length
          ? `${context.errors.length} uncaught JavaScript error(s) observed.`
          : "No uncaught JavaScript errors in the observation window.",
        context.errors,
      );
    case "mobile": {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(350);
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
      }));
      return result(
        metrics.width <= metrics.viewport + 4,
        `Document width ${metrics.width}px at a ${metrics.viewport}px viewport.`,
        [`Overflow: ${Math.max(0, metrics.width - metrics.viewport)}px`],
      );
    }
    case "text": {
      const found = (await page.locator("body").innerText()).includes(
        spec.value,
      );
      return result(
        found,
        found
          ? `Found “${spec.value}” in the visible page.`
          : `“${spec.value}” was not present in the visible page.`,
      );
    }
    case "selector": {
      const found = await page.locator(spec.value).first().isVisible();
      return result(
        found,
        found
          ? `Visible element matches ${spec.value}.`
          : `No visible element matches ${spec.value}.`,
      );
    }
    case "links": {
      const target = new URL(context.url);
      const hrefs = await page
        .locator("a[href]:visible")
        .evaluateAll((links) => links.map((a) => a.href));
      const eligible = [...new Set(hrefs)].filter((href) => {
        try {
          const u = new URL(href);
          return (
            ["http:", "https:"].includes(u.protocol) &&
            u.origin === target.origin &&
            !u.hash &&
            u.href !== target.href &&
            safeNavigation(u)
          );
        } catch {
          return false;
        }
      });
      const checked = eligible.slice(0, 5);
      const details = [];
      let failures = 0;
      for (const href of checked) {
        const tab = await page.context().newPage();
        try {
          const response = await tab.goto(href, {
            waitUntil: "domcontentloaded",
            timeout: 12000,
          });
          const status = response?.status() || 0;
          if (!status || status >= 400) failures++;
          details.push(`${status || "No response"} — ${href}`);
        } catch (error) {
          failures++;
          details.push(
            `Blocked or unavailable — ${href}: ${error.message.split("\n")[0]}`,
          );
        } finally {
          await tab.close();
        }
      }
      if (!checked.length)
        return {
          status: "blocked",
          summary: "No eligible same-origin navigation links to check.",
          details: [
            "Links with query strings, hash anchors, or state-changing path names are excluded.",
          ],
        };
      if (eligible.length > 5)
        details.push(
          `${eligible.length - 5} additional links were outside this bounded check.`,
        );
      return result(
        !failures,
        `${checked.length} link(s) checked; ${failures} did not resolve successfully.`,
        details,
      );
    }
    default:
      throw new Error("Unsupported check kind.");
  }
}
