# Snap Cal

**Snap → Scan → Schedule.** Take a photo of an event poster and turn it into a calendar event with reminders.

Snap Cal reads the poster, fills in the event name, date, time and venue, and lets you check them before anything is saved. Then add it to Apple Calendar, Outlook, Windows Calendar or Google Calendar in one tap.

- **Works everywhere:** it runs in any modern browser on iPhone, Android, Mac and Windows, and you can install it like an app.
- **Private:** your photos are read on your own device and never uploaded. There are no accounts, no tracking and no server.
- **Free and open source** under the MIT licence.

## Using it

1. Open the app. The link is under **About** on this GitHub page once Pages is turned on.
2. Tap **Snap poster** to use your camera, or **Upload image**. On a computer you can also drag an image in or paste one.
3. Check the details. Fix anything it got wrong and choose your reminders.
4. Tap **Add to calendar**. This saves an `.ics` file that includes your reminders.
   - **iPhone / iPad / Mac:** Safari offers "Add to Calendar" straight away. On a Mac you can also open the downloaded file.
   - **Windows:** open the downloaded file and it goes into Outlook or the Calendar app.
   - **Android:** open the downloaded file with Google Calendar.
   - **Google Calendar or Outlook.com on the web:** use those buttons instead. The event opens pre-filled, but those sites don't accept reminders from a link, so set the reminder there.

**Install it as an app:** on iPhone, tap Share → *Add to Home Screen*. On Android or in Chrome/Edge on a computer, use *Install app* in the browser menu. After your first scan it also works offline.

**Tips for the best results:** photograph the poster straight on, in good light, and fill the frame with it. The first scan downloads the text reader (about 10MB), so later scans are quicker.

## How it works

| Step | What it uses |
| --- | --- |
| Reading text | [tesseract.js](https://github.com/naptha/tesseract.js), running in the browser in sparse-text mode (built for posters) |
| Finding the date and time | [chrono](https://github.com/wanasit/chrono), plus a few rules for posters: split date and time lines, "9pm–2am" running past midnight, and matching the weekday to the right year |
| Finding the title | The largest text on the poster, which is usually the headline |
| Finding the venue | `Venue:` labels, `@ Place`, `at The Place`, venue words (club, hall, theatre, …) and UK postcodes |
| Saving the event | A standard iCalendar `.ics` file with `VALARM` reminders |

All the code is in [`src/`](src). The parsing rules are in [`src/parse.ts`](src/parse.ts) and are covered by tests in [`tests/`](tests).

## Running it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev      # start a local copy at http://localhost:5173
npm test         # run the tests
npm run build    # build the site into dist/
```

## Publishing on GitHub Pages

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Each push to `main` runs the tests, builds the site and publishes it to `https://<your-username>.github.io/<repo-name>/`.

## Contributing

Bug reports and posters it gets wrong are very welcome. Please open an issue, and include the text it read if you can. For code changes, add a test to `tests/parse.test.ts` that shows the poster text and what the app should find.

## Licence

[MIT](LICENSE)
