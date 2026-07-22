# PET Dashboard Production and Quality Layout Design

## Goal

Rearrange the existing TV dashboard to match the approved production/quality layout while preserving all current production data, Excel import, cloud synchronization, panel drag/resize behavior, and data-entry controls.

## Approved Layout

- Keep the existing top header, running status, clock, and action buttons.
- Divide the dashboard body into a left Production area and right Quality area using a 7:3 column ratio.
- Add clear bilingual section headings: `生产 / Production` and `质量 / Quality`.
- Keep all six existing daily KPI cards at the top of the Production area.
- Keep the existing production panels below the KPIs:
  - Daily production information on the left.
  - Shift output and downtime Pareto in the center.
  - Monthly summary, monthly production trend, and monthly downtime summary on the right.
- Place Visual Inspection in the upper 45% of the Quality area and enlarge its metrics and defect distribution.
- Place Thickness Trend in the lower 55% of the Quality area and give it enough height for the full report image.

## Thickness Image Behavior

- Display the complete imported thickness report image with its original aspect ratio.
- Use contained scaling so no edge, title, legend, axis, or time label is cropped.
- Center the image inside a restrained dark report surface; unused space is acceptable when the image aspect ratio differs from the panel.
- Keep the existing click-to-open full-screen preview.

## Interaction and Persistence

- Preserve Excel/PDF/image import and download behavior.
- Preserve cross-device synchronization and manual data entry.
- Preserve the six production/quality panels as draggable and resizable panels.
- Update the default slot geometry only; saved user layouts remain valid because panel IDs and slot IDs do not change.
- Reset Layout restores the new approved arrangement.

## Responsive Behavior

- Optimize the primary view for 1920x1080 and 55-inch TV display.
- Maintain readable scaling at 4K.
- On narrower screens, retain the existing minimum dashboard width and allow controlled page scrolling rather than compressing text or overlapping panels.

## Verification

- Add structural tests for the Production/Quality section layout and contained thickness image.
- Run the existing import and dashboard structure tests.
- Verify at 1920x1080 that the dashboard has no panel overlap, no unintended page scrolling, and the thickness report is fully visible.
- Verify the full-screen thickness preview and existing data controls still work.
