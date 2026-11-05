# Redesign: building first

November 2026. Why the tracker changed, and what it changed to.

## What was wrong

The tracker was accurate, accessible and well built, but it answered a supervisor's questions ("who is busiest, how do the offices compare") and not the question most people open it with: **what is happening in my building?** Three reviews (a building manager walking through real tasks, a code read, and a type and contrast audit) found:

1. **A building was never something you could go to.** No building list, no building page, building numbers weren't links. Finding the projects in one building meant typing its number into search on the Projects tab, and searching its name returned the wrong projects (18 instead of 5).
2. **The first screen was about workload.** Six money tiles, a "who has the most projects" chart, a 12-office comparison table: about 15 concepts and 43 controls above the fold, none of them about your buildings.
3. **Jargon.** On the Overview alone, EASi 12 times, BA61 6, BA54 5. "Not in EASi yet" names the data system, not the work. Four money words (committed, obligated, expended, left to spend) where most people need two.
4. **No way to reach anyone.** No email links; "who is the PM?" needed the project panel and a scroll.
5. **The text people need most was the smallest.** Body 16px, but the secondary lines that carry the building, the days in a step and "estimated" were 12.5–13px grey; on a phone 94% of text was under 15px.
6. **Phones got desktop tables** three times wider than the screen, and the filter bar took 180–270px before any data.
7. **No Back button.** Moving between views never added to the browser history, and a project had no link of its own.
8. **Form outlines failed WCAG 1.4.11** (2.85:1 on the page background), as did the lightest chart colors.

What was good, and stays: the plain-language EASi steps ("Out for bids", "Contract being written") with days in each; the Needs attention checks and their "what the data says" column; opening on your own office; links that keep the view; the plan-vs-EASi comparison; the data-freshness notes; keyboard support and dark mode.

## What it is now

**Buildings** is the new first tab and the page everyone opens on.

- **Your buildings**: one card per building you're the ServiceNow contact for (or, for a Field Office Manager, every building in your office; otherwise the buildings where you have projects). Each card shows the building's name, number and city, how many projects are active, a strip showing where they are (planned, in contracting, under way), and a flag when something needs a look.
- **Find a building**: one search box over every building in the enterprise, by name, number or city, including buildings with no projects.
- **Needs a look**: only money at risk and stalled work, in your buildings, worded as what's wrong. The data clean-up checks stay on the Needs attention tab.
- **Coming up**: planned projects in your buildings by the month they're due, with the year.

**A building page** (its own link, and Back works): name, address, building managers with email buttons, then every project in the building in four plain groups: **Planned**, **In contracting**, **Under way**, **Finished**. Each project shows its title, its step in plain words and how long it's been there, its budget and spending, and who to email. Service contracts are listed separately at the bottom.

**A project page** (its own link): who to contact first, with email buttons, then everything the old project panel showed.

The old views stay, for the people who use them, under plainer names: **All projects** (the sortable table), **Needs attention**, **People** (workload) and **Summary** (the old Overview).

## Plain words

| Was | Now |
|---|---|
| Not in EASi yet | Planned (no PR yet) |
| Not awarded yet | In contracting |
| Awarded | Under way |
| Paid in full | Finished |
| Committed / Obligated / Expended | Budget / Awarded / Spent (on the building pages; the table keeps EASi's terms) |

EASi, BA61, BA54 and BA80 still appear, as small tags and in project details, where the people who need them look.

## Type and touch

A new type scale with a 17px body and a 15px floor for any text a reader needs (tags are the one 14px exception), 44px controls (48px on a phone), darker secondary text, form outlines at 3:1 or better, and the Projects table stacking into cards on a phone.
