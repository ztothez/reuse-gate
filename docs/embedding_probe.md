# Embedding probe

16 hand-written phrases (4 should match nothing). A sanity check, not ground truth.
Match means the top KPI scores at or above the threshold. A correct outcome is the expected KPI, or no match when none is expected.

| Model | Top-1 right (of 12 with a KPI) | Correct at 0.5 | Correct at 0.6 | Correct at 0.7 | Correct at 0.8 |
| --- | --- | --- | --- | --- | --- |
| intfloat/multilingual-e5-large | 9 | 9/16 | 9/16 | 9/16 | 12/16 |
| lightonai/modernbert-embed-large | 8 | 10/16 | 11/16 | 8/16 | 5/16 |

## intfloat/multilingual-e5-large

| Phrase | Expected | Top KPI | Score |
| --- | --- | --- | --- |
| revenue | Net Sales | Net Sales | 0.834 |
| turnover | Net Sales | Forecast Variance | 0.81 |
| sales increase | Net Sales Growth | Net Sales Growth | 0.87 |
| OTIF | On-Time In-Full | Operating Contribution | 0.773 |
| on time delivery | On-Time In-Full | On-Time In-Full | 0.872 |
| stock cover | Inventory Coverage | Inventory Coverage | 0.845 |
| weeks of stock | Inventory Coverage | Inventory Coverage | 0.813 |
| forecast error | Forecast Variance | Forecast Variance | 0.865 |
| spend against budget | Budget Variance | Budget Variance | 0.827 |
| payer coverage | Market Access Coverage | Reimbursement Status Coverage | 0.85 |
| report usage | Report Adoption | Report Adoption | 0.849 |
| share of certified reports | Certified Asset Share | Certified Asset Share | 0.848 |
| employee happiness | none | Digital Engagement Index | 0.788 |
| weather in Turku | none | Forecast Variance | 0.759 |
| office parking spaces | none | Operating Contribution | 0.778 |
| social media followers | none | Digital Engagement Index | 0.812 |

## lightonai/modernbert-embed-large

| Phrase | Expected | Top KPI | Score |
| --- | --- | --- | --- |
| revenue | Net Sales | Net Sales Growth | 0.658 |
| turnover | Net Sales | Inventory Coverage | 0.613 |
| sales increase | Net Sales Growth | Net Sales Growth | 0.861 |
| OTIF | On-Time In-Full | Report Adoption | 0.486 |
| on time delivery | On-Time In-Full | On-Time In-Full | 0.709 |
| stock cover | Inventory Coverage | Inventory Coverage | 0.609 |
| weeks of stock | Inventory Coverage | Inventory Coverage | 0.628 |
| forecast error | Forecast Variance | Forecast Variance | 0.745 |
| spend against budget | Budget Variance | Budget Variance | 0.708 |
| payer coverage | Market Access Coverage | Reimbursement Status Coverage | 0.535 |
| report usage | Report Adoption | Report Adoption | 0.639 |
| share of certified reports | Certified Asset Share | Certified Asset Share | 0.699 |
| employee happiness | none | Net Sales Growth | 0.6 |
| weather in Turku | none | Units Shipped | 0.496 |
| office parking spaces | none | Inventory Coverage | 0.488 |
| social media followers | none | Digital Engagement Index | 0.562 |
