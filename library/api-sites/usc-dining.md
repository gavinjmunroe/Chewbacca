# usc-dining

USC Hospitality's residential dining menus (hospitality.usc.edu/dining-hall-menus) as read-only operations, for checking what a dining hall serves on a given day without opening the page. The page is WordPress and fills its menu from a public JSON route, `/wp-json/hsp-api/v1/get-res-dining-menus/{hall}?y=&m=&d=`, which returns all four meals for one hall and date. Every op below answered at tier 1 (direct HTTP, no browser, no login). The site's route returns every meal in one response that runs past api-anything's 20,000 character output cap at USC Village, so the menu is split into one op per meal, each reading `meals[N].stations` in the fixed order Breakfast, Brunch, Lunch, Dinner.

- `menuBreakfast(hall, year, month, day)` -> station, subtitle, menu (item, allergens, preferences, dietary_preferences)
- `menuBrunch(hall, year, month, day)` -> station, subtitle, menu (item, allergens, preferences, dietary_preferences)
- `menuLunch(hall, year, month, day)` -> station, subtitle, menu (item, allergens, preferences, dietary_preferences)
- `menuDinner(hall, year, month, day)` -> station, subtitle, menu (item, allergens, preferences, dietary_preferences)

## Caveats

- hall is one of `evk` (Everybody's Kitchen), `parkside` (Parkside Residential) or `university-village` (USC Village). These are the page's own `?venue=` values.
- The date is three params. month and day work with or without a leading zero (`10`/`9`, `010`/`009`); the stored examples are zero padded only because api-anything needs examples of three characters or more.
- A meal the hall does not serve that day comes back `ok: false, class: input` ("no results for these args ... the operation works"), which means the meal is not served. On 2026-10-09 weekdays served Breakfast, Lunch and Dinner, and weekends served Brunch and Dinner. EVK showed nothing at all for Oct 8, 9, 12 and 13.
- Menus were published only a few days ahead: on 2026-10-09 every hall had data through Oct 11 and nothing for Oct 12 or 13.
- allergens and preferences are the page's icon slugs (`dairy`, `gluten`, `not-analyzed`, `vegan`, `halal-ingredients`). dietary_preferences is the same information as display labels. The "Allergen Awareness Zone" station requires registration in person.
- A single all-meals op was tried and rejected: weekend responses start with an empty Breakfast, which api-anything's shape check reads as drift, and USC Village weekday days were truncated.
- Calls took 0.3 to 0.5 seconds. No rate limiting or bot challenge was seen.
