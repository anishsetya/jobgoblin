// Resume template t1: Jake's one-page resume layout, ported from the prototype's design.yaml.
// One column, US letter, real text, no graphics (applicant tracking systems read it cleanly).
// Spec: "Resume pipeline"; ARCHITECTURE.md section 8.1.
//
// HOW THIS FILE GETS ITS DATA
// The server never writes text into this file. It passes the whole resume as ONE JSON string in
// `sys.inputs.resume` (see src/resumeView.ts for the exact shape) and this file decodes it. Values that
// came from JSON are Typst strings, and a string shown in a document is printed literally, so characters
// such as # $ * _ @ < > and \ cannot turn into markup or code. Never build Typst source from resume
// text, and never call eval() on it.
//
// Typst basics for readers new to it:
//   #let name = value        defines a value or a function
//   #set rule(...)           changes defaults for everything after it
//   [ ... ]                  content (text with markup); #expr inside it inserts a value
//   ( ... )                  a code expression, such as an array

#let resume = json(bytes(sys.inputs.resume))

// ---------------------------------------------------------------------------------------------
// Design values (from design.yaml)
// ---------------------------------------------------------------------------------------------
#let body-color = rgb(20, 20, 20)
#let name-color = rgb(0, 0, 0)
#let headline-color = rgb(60, 60, 60)
#let contact-color = rgb(40, 40, 40)
#let rule-thickness = 0.6pt
#let line-spacing = 0.66em // distance between lines of one paragraph

#let name-size = 26pt
#let contact-size = 10.5pt
#let section-title-size = 1.15em // relative to the 11pt body text

#let space-below-name = 0.4cm
#let space-below-headline = 0.25cm
#let space-below-contact = 0.35cm
#let space-above-section-title = 0.55cm
#let space-below-section-title = 0.28cm
#let space-between-entries = 0.45cm

// ---------------------------------------------------------------------------------------------
// Page and text defaults
// ---------------------------------------------------------------------------------------------

// The version id travels inside the PDF, in its Keywords property, so the file can always be matched
// to the resume version it was built from. `date: none` leaves out the creation time, which makes the
// same resume produce the same bytes every time.
#set document(
  title: resume.documentTitle,
  author: resume.fullName,
  keywords: (resume.versionId,),
  date: none,
)

#set page(
  paper: "us-letter",
  margin: (top: 0.5in, bottom: 0.5in, left: 0.6in, right: 0.6in),
)

// "New Computer Modern" is bundled with Typst, so no font needs installing. Ligatures are off so that
// "fi" stays two letters for any program that reads the text back out of the PDF.
#set text(
  font: "New Computer Modern",
  size: 11pt,
  fill: body-color,
  lang: "en",
  region: "US",
  ligatures: false,
)

// Spacing between blocks is added by hand below, so every gap on the page is one of the named values above.
#set par(leading: line-spacing, spacing: 0pt, justify: false)
#set block(spacing: 0pt)

// Links look like the text around them: black, no underline.
#show link: set text(fill: contact-color)

// Bullets: a round bullet, a small indent, and one line's spacing plus a little extra between items.
// (Typst measures a line from the top of a capital letter to the baseline, so a gap smaller than the
// line spacing would pull the descenders of one bullet into the next.)
#set list(
  marker: [•],
  indent: 0.1cm,
  body-indent: 0.45em,
  spacing: line-spacing + 0.07cm,
)

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

// The contact items separated by " | ". An item with a url is a link; the rest is plain text.
#let contact-line(items) = {
  let parts = items.map(item => if item.url == none { item.text } else { link(item.url)[#item.text] })
  parts.join([#h(0.2cm)|#h(0.2cm)])
}

// A section title: small caps, bold, with a full-width rule under it. `sticky` keeps a title from
// being left alone at the bottom of a page.
#let section-title(title) = block(
  above: space-above-section-title,
  below: space-below-section-title,
  sticky: true,
  width: 100%,
  stack(
    spacing: 0.3em,
    text(size: section-title-size, weight: "bold", fill: name-color, smallcaps(title)),
    line(length: 100%, stroke: rule-thickness + name-color),
  ),
)

// The bold heading, followed by an italic note after a bar when there is one: "Ledgerline | Go".
#let entry-heading(item) = {
  strong(item.heading)
  if item.headingNote != "" {
    [#h(0.2cm)|#h(0.2cm)#emph(item.headingNote)]
  }
}

// One experience, project or school: up to two rows (bold left / right, italic left / right), then
// bullets. The second row is skipped when both of its cells are empty. The entry never splits across
// pages, so when a resume is too long the whole entry moves to page 2 and the page check fails loudly.
#let entry(item) = block(breakable: false, width: 100%, {
  let rows = (entry-heading(item), item.headingRight)
  if item.subheading != "" or item.subheadingRight != "" {
    rows.push(emph(item.subheading))
    rows.push(emph(item.subheadingRight))
  }
  grid(
    columns: (1fr, auto),
    column-gutter: 0.1cm,
    row-gutter: line-spacing,
    align: (left, right),
    ..rows,
  )

  if item.bullets.len() > 0 {
    v(line-spacing + 0.07cm)
    list(..item.bullets)
  }
})

// A titled section made of entries, with a gap between entries. Skipped when there are none.
#let entries-section(title, entries) = {
  if entries.len() == 0 { return }
  section-title(title)
  for (index, item) in entries.enumerate() {
    if index > 0 { v(space-between-entries) }
    entry(item)
  }
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

// Header: name, optional headline, contact line, all centered.
#align(center, {
  text(size: name-size, weight: "bold", fill: name-color, resume.fullName)

  if resume.headline != none {
    v(space-below-name)
    text(fill: headline-color, resume.headline)
    v(space-below-headline)
  } else {
    v(space-below-name - 0.1cm)
  }

  text(size: contact-size, fill: contact-color, contact-line(resume.contact))
  v(space-below-contact)
})

#entries-section("Experience", resume.experience)
#entries-section("Projects", resume.projects)

#if resume.skills.len() > 0 {
  section-title("Technical Skills")
  resume.skills.join(", ")
}

#entries-section("Education", resume.education)
