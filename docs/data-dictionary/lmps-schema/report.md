# Offline DDL metadata inventory

Coverage: **partial**. This is an inventory of declarations, not live database verification.

Source SHA-256: `446740c52ad188755d5751feaa2b92911efb2d13670c220eccc030e3822c5706`; bytes: 153054.
Parser: SQLGlot 30.23.0, MySQL dialect; report 0.1.0.

Tables: 100; columns: 1581; indexes: 345; foreign keys: 1.

Comments, default/enum values, raw SQL, data rows and storage-option values are not exported.
Data types are parser-normalized. `timestamptz` is SQLGlot's MySQL TIMESTAMP representation; it does not confirm source timezone settings.
Nullable is inferred from explicit NULL/NOT NULL, primary keys, auto-increment or the ordinary MySQL default. An unspecified TIMESTAMP is unknown pending server settings.

## Unverified inputs

- Live schema equivalence, actual row counts, distributions and uniqueness across feeds/history.
- Masked/full account representation, stable account identity, ownership and cross-role linkage.
- Routing participant versus account-owning bank mapping; currency units and lifecycle codebooks.
- Event/observed time semantics, historical availability, session timezone and timestamp settings.
- History overlap/move/copy semantics and business payment deduplication across tables.
- Binlog configuration, CDC compatibility/permissions, replica lag and snapshot/source impact.
- Peak/burst TPS, query plans, real performance and five-million-payments/day capacity.

## Coverage issues

| Code | Statement | Table | Column |
| --- | --- | --- | --- |
| EXECUTABLE_COMMENT_NOT_EXTRACTED | - | - | - |
| CHECK_EXPRESSION_NOT_EXTRACTED | 18 | crossborder_exchangerate | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 20 | crossborder_inquiry | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 20 | crossborder_inquiry | rawresponse |
| CHECK_EXPRESSION_NOT_EXTRACTED | 24 | crossborder_transfer | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 24 | crossborder_transfer | rawresponse |
| CHECK_EXPRESSION_NOT_EXTRACTED | 34 | electricity_payment | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 34 | electricity_payment | rawresponse |
| CHECK_EXPRESSION_NOT_EXTRACTED | 40 | fee002 | request |
| CHECK_EXPRESSION_NOT_EXTRACTED | 40 | fee002 | response |
| CHECK_EXPRESSION_NOT_EXTRACTED | 58 | finpass_log | declarations |
| CHECK_EXPRESSION_NOT_EXTRACTED | 58 | finpass_log | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 58 | finpass_log | rawresponse |
| CREATE_TAIL_OR_SYNTAX_NOT_EXTRACTED | 60 | - | - |
| CREATE_TAIL_OR_SYNTAX_NOT_EXTRACTED | 64 | - | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 94 | landtax_inquiry | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 94 | landtax_inquiry | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 96 | landtax_payment | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 96 | landtax_payment | - |
| CHECK_EXPRESSION_NOT_EXTRACTED | 112 | pushtransfer | rawrequest |
| CHECK_EXPRESSION_NOT_EXTRACTED | 112 | pushtransfer | rawresponse |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 120 | roadtax_inquiry | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 120 | roadtax_inquiry | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 122 | roadtax_payment | - |
| TABLE_CONSTRAINT_NOT_EXTRACTED | 122 | roadtax_payment | - |
| GENERATED_EXPRESSION_NOT_EXTRACTED | 136 | th_transaction | txtime_dt |
| CREATE_TAIL_OR_SYNTAX_NOT_EXTRACTED | 140 | - | - |
| GENERATED_EXPRESSION_NOT_EXTRACTED | 140 | transfer | requesttime_dt |
| CREATE_TAIL_OR_SYNTAX_NOT_EXTRACTED | 144 | - | - |
| GENERATED_EXPRESSION_NOT_EXTRACTED | 144 | transfer_hist | requesttime_dt |
| GENERATED_EXPRESSION_NOT_EXTRACTED | 146 | transfer_old | requesttime_dt |

## History/backup name candidates

Names/types only, not confirmed source mapping or identity. History names do not prove overlap.

- `backup_inquiry_date_error_20240306`
- `backup_tb_inquiry_incorrect_datetime_20260311`
- `backup_tb_transfer_incorrect_datetime_20260311`
- `backup_transfer_date_error_20240306`
- `inquiry_hist`
- `inquiry_old`
- `log_20260311`
- `transfer_hist`
- `transfer_old`
- `upi_incomming_20251231`
- `upi_message_old`
- `upi_rate_history`
- `upi_trx_status_notification_old`

## Field candidates requiring owner review

| Table | Column | Candidate roles |
| --- | --- | --- |
| backup_inquiry_date_error_20240306 | id | row_identifier |
| backup_inquiry_date_error_20240306 | txtime | time_field |
| backup_inquiry_date_error_20240306 | requesttime | time_field |
| backup_inquiry_date_error_20240306 | reference | transaction_reference |
| backup_inquiry_date_error_20240306 | frommember | routing_or_bank_field |
| backup_inquiry_date_error_20240306 | fromuser | sender_related_unverified |
| backup_inquiry_date_error_20240306 | fromaccount | sender_account_field |
| backup_inquiry_date_error_20240306 | totype | product_or_channel |
| backup_inquiry_date_error_20240306 | toaccount | receiver_account_field |
| backup_inquiry_date_error_20240306 | tomember | routing_or_bank_field |
| backup_inquiry_date_error_20240306 | responsetime | time_field |
| backup_inquiry_date_error_20240306 | result | lifecycle_or_status |
| backup_inquiry_date_error_20240306 | amount | money_or_currency |
| backup_inquiry_date_error_20240306 | qrtype | product_or_channel |
| backup_tb_inquiry_incorrect_datetime_20260311 | id | row_identifier |
| backup_tb_inquiry_incorrect_datetime_20260311 | txtime | time_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | requesttime | time_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | reference | transaction_reference |
| backup_tb_inquiry_incorrect_datetime_20260311 | frommember | routing_or_bank_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | fromuser | sender_related_unverified |
| backup_tb_inquiry_incorrect_datetime_20260311 | fromaccount | sender_account_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | totype | product_or_channel |
| backup_tb_inquiry_incorrect_datetime_20260311 | toaccount | receiver_account_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | tomember | routing_or_bank_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | responsetime | time_field |
| backup_tb_inquiry_incorrect_datetime_20260311 | result | lifecycle_or_status |
| backup_tb_inquiry_incorrect_datetime_20260311 | amount | money_or_currency |
| backup_tb_inquiry_incorrect_datetime_20260311 | qrtype | product_or_channel |
| backup_tb_transfer_incorrect_datetime_20260311 | id | row_identifier |
| backup_tb_transfer_incorrect_datetime_20260311 | txtime | time_field |
| backup_tb_transfer_incorrect_datetime_20260311 | requesttime | time_field |
| backup_tb_transfer_incorrect_datetime_20260311 | reference | transaction_reference |
| backup_tb_transfer_incorrect_datetime_20260311 | frommember | routing_or_bank_field |
| backup_tb_transfer_incorrect_datetime_20260311 | fromuser | sender_related_unverified |
| backup_tb_transfer_incorrect_datetime_20260311 | fromaccount | sender_account_field |
| backup_tb_transfer_incorrect_datetime_20260311 | totype | product_or_channel |
| backup_tb_transfer_incorrect_datetime_20260311 | toaccount | receiver_account_field |
| backup_tb_transfer_incorrect_datetime_20260311 | tomember | routing_or_bank_field |
| backup_tb_transfer_incorrect_datetime_20260311 | responsetime | time_field |
| backup_tb_transfer_incorrect_datetime_20260311 | result | lifecycle_or_status |
| backup_tb_transfer_incorrect_datetime_20260311 | amount | money_or_currency |
| backup_tb_transfer_incorrect_datetime_20260311 | ccy | money_or_currency |
| backup_tb_transfer_incorrect_datetime_20260311 | isreconciled | lifecycle_or_status |
| backup_tb_transfer_incorrect_datetime_20260311 | issettled | lifecycle_or_status |
| backup_tb_transfer_incorrect_datetime_20260311 | settletime | time_field |
| backup_tb_transfer_incorrect_datetime_20260311 | txtype | product_or_channel |
| backup_tb_transfer_incorrect_datetime_20260311 | fee | money_or_currency |
| backup_tb_transfer_incorrect_datetime_20260311 | originalreference | transaction_reference |
| backup_tb_transfer_incorrect_datetime_20260311 | shouldrevert | lifecycle_or_status |
| backup_tb_transfer_incorrect_datetime_20260311 | qrtype | product_or_channel |
| backup_tb_transfer_incorrect_datetime_20260311 | requesttime_dt | time_field |
| backup_transfer_date_error_20240306 | id | row_identifier |
| backup_transfer_date_error_20240306 | txtime | time_field |
| backup_transfer_date_error_20240306 | requesttime | time_field |
| backup_transfer_date_error_20240306 | reference | transaction_reference |
| backup_transfer_date_error_20240306 | frommember | routing_or_bank_field |
| backup_transfer_date_error_20240306 | fromuser | sender_related_unverified |
| backup_transfer_date_error_20240306 | fromaccount | sender_account_field |
| backup_transfer_date_error_20240306 | totype | product_or_channel |
| backup_transfer_date_error_20240306 | toaccount | receiver_account_field |
| backup_transfer_date_error_20240306 | tomember | routing_or_bank_field |
| backup_transfer_date_error_20240306 | responsetime | time_field |
| backup_transfer_date_error_20240306 | result | lifecycle_or_status |
| backup_transfer_date_error_20240306 | amount | money_or_currency |
| backup_transfer_date_error_20240306 | ccy | money_or_currency |
| backup_transfer_date_error_20240306 | isreconciled | lifecycle_or_status |
| backup_transfer_date_error_20240306 | issettled | lifecycle_or_status |
| backup_transfer_date_error_20240306 | settletime | time_field |
| backup_transfer_date_error_20240306 | txtype | product_or_channel |
| backup_transfer_date_error_20240306 | fee | money_or_currency |
| backup_transfer_date_error_20240306 | originalreference | transaction_reference |
| backup_transfer_date_error_20240306 | shouldrevert | lifecycle_or_status |
| backup_transfer_date_error_20240306 | qrtype | product_or_channel |
| backup_transfer_date_error_20240306 | requesttime_dt | time_field |
| bol_settlement | id | row_identifier |
| bol_settlement | settlement_date | time_field |
| bol_settlement | tx_date | time_field |
| bol_settlement | ccy | money_or_currency |
| bol_settlement_files | txdate | time_field |
| bol_settlement_links | added_datetime | time_field |
| bol_settlement_links | last_update | time_field |
| check_transaction | id | row_identifier |
| check_transaction | reference | transaction_reference |
| check_transaction | frommember | routing_or_bank_field |
| check_transaction | tomember | routing_or_bank_field |
| check_transaction | result | lifecycle_or_status |
| check_transaction | txtime | time_field |
| check_transaction | txdate | time_field |
| crossborder_exchangerate | id | row_identifier |
| crossborder_exchangerate | ccy | money_or_currency |
| crossborder_exchangerate | fromdate | time_field |
| crossborder_exchangerate | todate | time_field |
| crossborder_exchangerate | lastupdate | time_field |
| crossborder_exchangerate | frommember | routing_or_bank_field |
| crossborder_inquiry | id | row_identifier |
| crossborder_inquiry | txtime | time_field |
| crossborder_inquiry | reference | transaction_reference |
| crossborder_inquiry | frommember | routing_or_bank_field |
| crossborder_inquiry | tomember | routing_or_bank_field |
| crossborder_inquiry | result | lifecycle_or_status |
| crossborder_remarks | id | row_identifier |
| crossborder_remarks | datepost | time_field |
| crossborder_remarks | fixdate | time_field |
| crossborder_remarks | adjdate | time_field |
| crossborder_remarks | checkerdate | time_field |
| crossborder_remarks | canceldate | time_field |
| crossborder_remarks | inverifydate | time_field |
| crossborder_remarks | outverifydate | time_field |
| crossborder_transfer | id | row_identifier |
| crossborder_transfer | txtime | time_field |
| crossborder_transfer | reference | transaction_reference |
| crossborder_transfer | frommember | routing_or_bank_field |
| crossborder_transfer | tomember | routing_or_bank_field |
| crossborder_transfer | result | lifecycle_or_status |
| crossborder_transfer | amount | money_or_currency |
| disputes | status | lifecycle_or_status |
| disputes | created_at | time_field |
| disputes | updated_at | time_field |
| disputes | frommember | routing_or_bank_field |
| disputes | tomember | routing_or_bank_field |
| disputes | amount | money_or_currency |
| disputes | txtime | time_field |
| disputes | transaction_date | time_field |
| dispute_attachments | status | lifecycle_or_status |
| dispute_attachments | uploaded_at | time_field |
| dispute_messages | created_at | time_field |
| ecny_icomming_file_transactions | id | row_identifier |
| ecny_icomming_file_transactions | txn_complete_time | time_field |
| ecny_icomming_file_transactions | created_at | time_field |
| electricity_payment | reference | transaction_reference |
| electricity_payment | frommember | routing_or_bank_field |
| electricity_payment | responsetime | time_field |
| extra_limit | id | row_identifier |
| extra_limit | frommember | routing_or_bank_field |
| extra_limit | tomember | routing_or_bank_field |
| extra_limit | amount | money_or_currency |
| extra_limit | ccy | money_or_currency |
| extra_limit | status | lifecycle_or_status |
| extra_limit | lastupdate | time_field |
| fee | id | row_identifier |
| fee | ccy | money_or_currency |
| fee002 | txtime | time_field |
| fee002 | frommember | routing_or_bank_field |
| fee002 | responsetime | time_field |
| fee002 | result | lifecycle_or_status |
| fee002 | reference | transaction_reference |
| fee_promotion | id | row_identifier |
| fee_promotion | ccy | money_or_currency |
| fee_promotion | insert_date | time_field |
| finlink_cancel_log | canceltime | time_field |
| finlink_cancel_log | reference | transaction_reference |
| finlink_feecode | id | row_identifier |
| finlink_log | txtime | time_field |
| finlink_log | frommember | routing_or_bank_field |
| finlink_log | tomember | routing_or_bank_field |
| finlink_log | reference | transaction_reference |
| finlink_log | responsetime | time_field |
| finlink_log | id | row_identifier |
| finlink_log | txdate | time_field |
| finlink_temp | reference | transaction_reference |
| finlink_temp | txtime | time_field |
| finlink_transit_acc_movement | id | row_identifier |
| finlink_transit_acc_movement | amount | money_or_currency |
| finlink_transit_acc_movement | frommember | routing_or_bank_field |
| finlink_transit_acc_movement | txndate | time_field |
| finlink_transit_acc_movement | txtime | time_field |
| finlink_transit_acc_movement | settledate | time_field |
| finlink_transit_acc_movement | sent_time | time_field |
| finlink_transit_items | id | row_identifier |
| finlink_transit_items | reference | transaction_reference |
| finlink_transit_items | requesttime | time_field |
| finlink_travelfee_settlement | id | row_identifier |
| finlink_travelfee_settlement | amount | money_or_currency |
| finlink_travelfee_settlement | frommember | routing_or_bank_field |
| finlink_travelfee_settlement | txndate | time_field |
| finlink_travelfee_settlement | txtime | time_field |
| finlink_travelfee_settlement | settledate | time_field |
| finlink_travelfee_settlement | sent_time | time_field |
| finpass_log | id | row_identifier |
| finpass_log | txtime | time_field |
| finpass_log | reference | transaction_reference |
| finpass_log | frommember | routing_or_bank_field |
| finpass_log | responsetime | time_field |
| inquiry | id | row_identifier |
| inquiry | txtime | time_field |
| inquiry | requesttime | time_field |
| inquiry | reference | transaction_reference |
| inquiry | frommember | routing_or_bank_field |
| inquiry | fromuser | sender_related_unverified |
| inquiry | fromaccount | sender_account_field |
| inquiry | totype | product_or_channel |
| inquiry | toaccount | receiver_account_field |
| inquiry | tomember | routing_or_bank_field |
| inquiry | responsetime | time_field |
| inquiry | result | lifecycle_or_status |
| inquiry | amount | money_or_currency |
| inquiry | qrtype | product_or_channel |
| inquiry | fromchannel | product_or_channel |
| inquiryiso | reference | transaction_reference |
| inquiryiso | frommember | routing_or_bank_field |
| inquiryiso | tomember | routing_or_bank_field |
| inquiryiso | txtime | time_field |
| inquiry_hist | id | row_identifier |
| inquiry_hist | txtime | time_field |
| inquiry_hist | requesttime | time_field |
| inquiry_hist | reference | transaction_reference |
| inquiry_hist | frommember | routing_or_bank_field |
| inquiry_hist | fromuser | sender_related_unverified |
| inquiry_hist | fromaccount | sender_account_field |
| inquiry_hist | totype | product_or_channel |
| inquiry_hist | toaccount | receiver_account_field |
| inquiry_hist | tomember | routing_or_bank_field |
| inquiry_hist | responsetime | time_field |
| inquiry_hist | result | lifecycle_or_status |
| inquiry_hist | amount | money_or_currency |
| inquiry_hist | qrtype | product_or_channel |
| inquiry_old | id | row_identifier |
| inquiry_old | txtime | time_field |
| inquiry_old | requesttime | time_field |
| inquiry_old | reference | transaction_reference |
| inquiry_old | frommember | routing_or_bank_field |
| inquiry_old | fromuser | sender_related_unverified |
| inquiry_old | fromaccount | sender_account_field |
| inquiry_old | totype | product_or_channel |
| inquiry_old | toaccount | receiver_account_field |
| inquiry_old | tomember | routing_or_bank_field |
| inquiry_old | responsetime | time_field |
| inquiry_old | result | lifecycle_or_status |
| inquiry_old | amount | money_or_currency |
| inquiry_old | qrtype | product_or_channel |
| inquiry_reference | reference | transaction_reference |
| itmx_acknowledge | settledate | time_field |
| itmx_acknowledge | uploaddate | time_field |
| itmx_acknowledge_details | id | row_identifier |
| itmx_acknowledge_details | settledate | time_field |
| itmx_acknowledge_details | amount | money_or_currency |
| itmx_acknowledge_details | ccy | money_or_currency |
| itmx_adjustment | id | row_identifier |
| itmx_adjustment | settledate | time_field |
| itmx_adjustment | uploaddate | time_field |
| itmx_adjustment_detail | id | row_identifier |
| itmx_adjustment_detail | settledate | time_field |
| itmx_adjustment_detail | replydate | time_field |
| itmx_adjustment_detail | txtime | time_field |
| itmx_dailysettlement | settledate | time_field |
| itmx_dailysettlement | uploaddate | time_field |
| itmx_dailysettlement | processdate | time_field |
| itmx_dailysettlement | fee | money_or_currency |
| itmx_dailysettlement | ccy | money_or_currency |
| itmx_dailysettlement_details | id | row_identifier |
| itmx_dailysettlement_details | settledate | time_field |
| itmx_dailysettlement_details | amount | money_or_currency |
| itmx_dailysettlement_details | ccy | money_or_currency |
| itmx_file_transaction | txtime | time_field |
| itmx_settlement_summary | id | row_identifier |
| itmx_settlement_summary | settledate | time_field |
| itmx_settlement_summary | processdate | time_field |
| itmx_settlement_summary | amount | money_or_currency |
| itmx_settlement_summary | fee | money_or_currency |
| itmx_settlement_summary | uploaddate | time_field |
| itmx_unmatch | atdate | time_field |
| itmx_unmatch | processdate | time_field |
| itmx_unmatch | uploaddate | time_field |
| itmx_unmatchfixer_error | processdatetime | time_field |
| itmx_unmatchfixer_error | processdate | time_field |
| itmx_unmatchfixer_error | result | lifecycle_or_status |
| itmx_unmatchfixer_error | status | lifecycle_or_status |
| itmx_unmatchfixer_error | fixdatetime | time_field |
| itmx_unmatchfixer_schedule | lastcheckdate | time_field |
| itmx_unmatchfixer_schedule | lastsettledate | time_field |
| itmx_unmatch_details | id | row_identifier |
| itmx_unmatch_details | txtdate | time_field |
| itmx_unmatch_details | amount | money_or_currency |
| landtax_inquiry | reference | transaction_reference |
| landtax_inquiry | txtime | time_field |
| landtax_inquiry | requesttime | time_field |
| landtax_inquiry | frommember | routing_or_bank_field |
| landtax_inquiry | responsetime | time_field |
| landtax_inquiry | result | lifecycle_or_status |
| landtax_payment | reference | transaction_reference |
| landtax_payment | frommember | routing_or_bank_field |
| landtax_payment | txtime | time_field |
| landtax_payment | requesttime | time_field |
| landtax_payment | responsetime | time_field |
| landtax_payment | result | lifecycle_or_status |
| landtax_payment | issettled | lifecycle_or_status |
| landtax_payment | fromuser | sender_related_unverified |
| landtax_payment | fromaccount | sender_account_field |
| lmps_transfer_count | frommember | routing_or_bank_field |
| lmps_transfer_count | fromaccount | sender_account_field |
| lmps_transfer_count | totype | product_or_channel |
| lmps_transfer_count | qrtype | product_or_channel |
| log_20260311 | ID | row_identifier |
| log_20260311 | memberbank_txtime | time_field |
| member | iin | routing_or_bank_field |
| member | status | lifecycle_or_status |
| memberblock | id | row_identifier |
| memberblock | frommember | routing_or_bank_field |
| memberblock | tomember | routing_or_bank_field |
| memberblock | fromtime | time_field |
| memberblock | totime | time_field |
| memberblock | deletedtime | time_field |
| memberdown | id | row_identifier |
| memberdown | fromtime | time_field |
| memberdown | totime | time_field |
| memberdown | deletedtime | time_field |
| membermulticcy | id | row_identifier |
| membermulticcy | addedtime | time_field |
| membermulticcy | status | lifecycle_or_status |
| membermulticcy | deletedtime | time_field |
| notify | id | row_identifier |
| notify | txtime | time_field |
| notify | requesttime | time_field |
| notify | reference | transaction_reference |
| notify | responsetime | time_field |
| notify | result | lifecycle_or_status |
| pushtransfer | id | row_identifier |
| pushtransfer | txtime | time_field |
| pushtransfer | reference | transaction_reference |
| pushtransfer | frommember | routing_or_bank_field |
| pushtransfer | tomember | routing_or_bank_field |
| pushtransfer | responsetime | time_field |
| pushtransfer | result | lifecycle_or_status |
| qrtype | id | row_identifier |
| remarks | id | row_identifier |
| remarks | datepost | time_field |
| remarks | fixdate | time_field |
| remarks | adjdate | time_field |
| remarks | checkerdate | time_field |
| remarks | canceldate | time_field |
| resultmodifyhistory | txtime | time_field |
| resultmodifyhistory | reference | transaction_reference |
| roadtax_inquiry | reference | transaction_reference |
| roadtax_inquiry | txtime | time_field |
| roadtax_inquiry | requesttime | time_field |
| roadtax_inquiry | frommember | routing_or_bank_field |
| roadtax_inquiry | responsetime | time_field |
| roadtax_inquiry | result | lifecycle_or_status |
| roadtax_payment | reference | transaction_reference |
| roadtax_payment | frommember | routing_or_bank_field |
| roadtax_payment | txtime | time_field |
| roadtax_payment | requesttime | time_field |
| roadtax_payment | responsetime | time_field |
| roadtax_payment | result | lifecycle_or_status |
| roadtax_payment | issettled | lifecycle_or_status |
| roadtax_payment | fromuser | sender_related_unverified |
| rtgs_limis_log | requestdatetime | time_field |
| rtgs_limis_log | amount | money_or_currency |
| rtgs_limis_log | ccy | money_or_currency |
| rtgs_limis_log | txndate | time_field |
| rtgs_limis_log | lifmis_process_date | time_field |
| temp_debug_log | id | row_identifier |
| temp_debug_log | log_time | time_field |
| temp_lnsw | reference | transaction_reference |
| temp_lnsw | amount | money_or_currency |
| temp_orgl_transfer20260311 | frommember | routing_or_bank_field |
| temp_orgl_transfer20260311 | tomember | routing_or_bank_field |
| temp_orgl_transfer20260311 | result | lifecycle_or_status |
| temp_orgl_transfer20260311 | ccy | money_or_currency |
| temp_orgl_transfer20260311 | amount | money_or_currency |
| temp_orgl_transfer20260311 | reference | transaction_reference |
| temp_orgl_transfer20260311 | requesttime_dt | time_field |
| temp_orgl_transfer20260311 | requesttime | time_field |
| temp_orgl_transfer20260311 | responsetime | time_field |
| temp_orgl_transfer20260311 | sourcetxtime | time_field |
| temp_orgl_transfer20260311 | memberbank_txtime | time_field |
| temp_transfer_id | id | row_identifier |
| th_incoming_log | txtime | time_field |
| th_transaction | id | row_identifier |
| th_transaction | txtime | time_field |
| th_transaction | ccy | money_or_currency |
| th_transaction | frommember | routing_or_bank_field |
| th_transaction | fromuser | sender_related_unverified |
| th_transaction | fromaccount | sender_account_field |
| th_transaction | tomember | routing_or_bank_field |
| th_transaction | toaccount | receiver_account_field |
| th_transaction | reference | transaction_reference |
| th_transaction | result | lifecycle_or_status |
| th_transaction | void_date | time_field |
| th_transaction | txtime_dt | time_field |
| th_update_error | reference | transaction_reference |
| transfer | id | row_identifier |
| transfer | txtime | time_field |
| transfer | requesttime | time_field |
| transfer | reference | transaction_reference |
| transfer | frommember | routing_or_bank_field |
| transfer | fromuser | sender_related_unverified |
| transfer | fromaccount | sender_account_field |
| transfer | totype | product_or_channel |
| transfer | toaccount | receiver_account_field |
| transfer | tomember | routing_or_bank_field |
| transfer | responsetime | time_field |
| transfer | result | lifecycle_or_status |
| transfer | amount | money_or_currency |
| transfer | ccy | money_or_currency |
| transfer | isreconciled | lifecycle_or_status |
| transfer | issettled | lifecycle_or_status |
| transfer | settletime | time_field |
| transfer | txtype | product_or_channel |
| transfer | fee | money_or_currency |
| transfer | originalreference | transaction_reference |
| transfer | shouldrevert | lifecycle_or_status |
| transfer | qrtype | product_or_channel |
| transfer | requesttime_dt | time_field |
| transfer | fromchannel | product_or_channel |
| transferiso | reference | transaction_reference |
| transferiso | frommember | routing_or_bank_field |
| transferiso | tomember | routing_or_bank_field |
| transferiso | txtime | time_field |
| transfer_hist | id | row_identifier |
| transfer_hist | txtime | time_field |
| transfer_hist | requesttime | time_field |
| transfer_hist | reference | transaction_reference |
| transfer_hist | frommember | routing_or_bank_field |
| transfer_hist | fromuser | sender_related_unverified |
| transfer_hist | fromaccount | sender_account_field |
| transfer_hist | totype | product_or_channel |
| transfer_hist | toaccount | receiver_account_field |
| transfer_hist | tomember | routing_or_bank_field |
| transfer_hist | responsetime | time_field |
| transfer_hist | result | lifecycle_or_status |
| transfer_hist | amount | money_or_currency |
| transfer_hist | ccy | money_or_currency |
| transfer_hist | isreconciled | lifecycle_or_status |
| transfer_hist | issettled | lifecycle_or_status |
| transfer_hist | settletime | time_field |
| transfer_hist | txtype | product_or_channel |
| transfer_hist | fee | money_or_currency |
| transfer_hist | originalreference | transaction_reference |
| transfer_hist | shouldrevert | lifecycle_or_status |
| transfer_hist | qrtype | product_or_channel |
| transfer_hist | requesttime_dt | time_field |
| transfer_old | id | row_identifier |
| transfer_old | txtime | time_field |
| transfer_old | requesttime | time_field |
| transfer_old | reference | transaction_reference |
| transfer_old | frommember | routing_or_bank_field |
| transfer_old | fromuser | sender_related_unverified |
| transfer_old | fromaccount | sender_account_field |
| transfer_old | totype | product_or_channel |
| transfer_old | toaccount | receiver_account_field |
| transfer_old | tomember | routing_or_bank_field |
| transfer_old | responsetime | time_field |
| transfer_old | result | lifecycle_or_status |
| transfer_old | amount | money_or_currency |
| transfer_old | ccy | money_or_currency |
| transfer_old | isreconciled | lifecycle_or_status |
| transfer_old | issettled | lifecycle_or_status |
| transfer_old | settletime | time_field |
| transfer_old | txtype | product_or_channel |
| transfer_old | fee | money_or_currency |
| transfer_old | originalreference | transaction_reference |
| transfer_old | shouldrevert | lifecycle_or_status |
| transfer_old | qrtype | product_or_channel |
| transfer_old | requesttime_dt | time_field |
| transfer_reference | reference | transaction_reference |
| upi_block_merchant | adddate | time_field |
| upi_block_merchant | tomember | routing_or_bank_field |
| upi_chargeback | id | row_identifier |
| upi_chargeback | full_date | time_field |
| upi_chargeback | dispute_stlm_date | time_field |
| upi_chargeback | created_at | time_field |
| upi_chargeback | updated_at | time_field |
| upi_dispute_transaction | id | row_identifier |
| upi_dispute_transaction | full_date | time_field |
| upi_dispute_transaction | transmission_date_time | time_field |
| upi_dispute_transaction | created_at | time_field |
| upi_dispute_transaction | updated_at | time_field |
| upi_enc_certificate_uias | OP_ENC_CER_DATE | time_field |
| upi_fee_detail | id | row_identifier |
| upi_fee_detail | full_date | time_field |
| upi_fee_detail | transmission_date_time | time_field |
| upi_fee_detail | created_at | time_field |
| upi_fee_detail | updated_at | time_field |
| upi_fee_disbursement | id | row_identifier |
| upi_fee_disbursement | full_date | time_field |
| upi_fee_disbursement | dispute_stlm_date | time_field |
| upi_fee_disbursement | amount | money_or_currency |
| upi_fee_disbursement | created_at | time_field |
| upi_fee_disbursement | updated_at | time_field |
| upi_incomming | ID | row_identifier |
| upi_incomming | TRANSMITDATE | time_field |
| upi_incomming | SETTLE_DATE | time_field |
| upi_incomming_20251231 | ID | row_identifier |
| upi_incomming_20251231 | TRANSMITDATE | time_field |
| upi_incomming_20251231 | SETTLE_DATE | time_field |
| upi_message | XCQTIME | time_field |
| upi_message | TOMEMBER | routing_or_bank_field |
| upi_message_old | XCQTIME | time_field |
| upi_rate_history | txtime | time_field |
| upi_settlement_summary | id | row_identifier |
| upi_settlement_summary | full_date | time_field |
| upi_settlement_summary | created_at | time_field |
| upi_settlement_summary | updated_at | time_field |
| upi_sing_certificate_uias | OP_SIGN_CER_DATE | time_field |
| upi_trx_status_notification | TXTIME | time_field |
| upi_trx_status_notification | REFUNDDATE | time_field |
| upi_trx_status_notification | ISSETTLED | lifecycle_or_status |
| upi_trx_status_notification | XCQTIME | time_field |
| upi_trx_status_notification | TOMEMBER | routing_or_bank_field |
| upi_trx_status_notification_old | TXTIME | time_field |
| upi_trx_status_notification_old | REFUNDDATE | time_field |
| upi_trx_status_notification_old | ISSETTLED | lifecycle_or_status |
| upi_uias_certificate | UIAS_CER_DATE | time_field |
| users | registerdate | time_field |
| user_role | txtime | time_field |
| vn_disputedetails | id | row_identifier |
| vn_disputedetails | settlementdate | time_field |
| vn_disputedetails | inserted_at | time_field |
| vn_dispute_import | id | row_identifier |
| vn_dispute_import | file_date | time_field |
| vn_dispute_import | imported_at | time_field |
| vn_outbound_reconcile_tc | id | row_identifier |
| vn_outbound_reconcile_tc | IMPORTDATE | time_field |
| vn_outbound_reconcile_xl | id | row_identifier |
| vn_outbound_reconcile_xl | IMPORTDATE | time_field |
| vn_transaction | id | row_identifier |
| vn_transaction | txtime | time_field |
| vn_transaction | channel | product_or_channel |
| vn_transaction | frommember | routing_or_bank_field |
| vn_transaction | fromuser | sender_related_unverified |
| vn_transaction | fromaccount | sender_account_field |
| vn_transaction | tomember | routing_or_bank_field |
| vn_transaction | toaccount | receiver_account_field |
| vn_transaction | reference | transaction_reference |
| vn_transaction | result | lifecycle_or_status |
| vn_transaction | void_date | time_field |
| vn_transaction | opdate | time_field |
| vn_transaction | settlementdate | time_field |
| vn_vietnam_bank | id | row_identifier |
| vn_xl_details | id | row_identifier |
| vn_xl_details | settle_date_full | time_field |
| vn_xl_details | inserted_at | time_field |
| vn_xl_importlog | id | row_identifier |
| vn_xl_importlog | file_date | time_field |
| vn_xl_importlog | imported_at | time_field |

## Table `backup_inquiry_date_error_20240306`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | true | implicit_mysql_default | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| fromuser | varchar(200) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(200) | true | implicit_mysql_default | False | False |
| totype | varchar(200) | true | implicit_mysql_default | False | False |
| toaccount | varchar(5000) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| accountname | varchar(200) | true | implicit_mysql_default | False | False |
| accountlocation | varchar(300) | true | implicit_mysql_default | False | False |
| accountphone | varchar(200) | true | implicit_mysql_default | False | False |
| accountccy | varchar(200) | true | implicit_mysql_default | False | False |
| invoice | varchar(200) | true | implicit_mysql_default | False | False |
| terminal | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| purpose | varchar(1000) | true | implicit_mysql_default | False | False |
| purposerequired | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `backup_tb_inquiry_incorrect_datetime_20260311`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| fromuser | varchar(200) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(200) | true | implicit_mysql_default | False | False |
| totype | varchar(200) | true | implicit_mysql_default | False | False |
| toaccount | varchar(5000) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| accountname | varchar(200) | true | implicit_mysql_default | False | False |
| accountlocation | varchar(300) | true | implicit_mysql_default | False | False |
| accountphone | varchar(200) | true | implicit_mysql_default | False | False |
| accountccy | varchar(200) | true | implicit_mysql_default | False | False |
| invoice | varchar(200) | true | implicit_mysql_default | False | False |
| terminal | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| purpose | varchar(1000) | true | implicit_mysql_default | False | False |
| purposerequired | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `backup_tb_transfer_incorrect_datetime_20260311`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| fromuser | varchar(200) | false | explicit | False | False |
| fromaccount | varchar(200) | false | explicit | False | False |
| totype | varchar(200) | false | explicit | False | False |
| toaccount | varchar(5000) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| purpose | varchar(500) | true | implicit_mysql_default | False | False |
| isreconciled | tinyint(1) | false | explicit | False | False |
| issettled | tinyint(1) | false | explicit | False | False |
| settletime | datetime | true | implicit_mysql_default | False | False |
| txtype | varchar(200) | true | implicit_mysql_default | False | False |
| fee | decimal(24,2) | true | implicit_mysql_default | False | False |
| originalreference | varchar(200) | true | implicit_mysql_default | False | False |
| shouldrevert | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | False |
| receipt | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `backup_transfer_date_error_20240306`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| fromuser | varchar(200) | false | explicit | False | False |
| fromaccount | varchar(200) | false | explicit | False | False |
| totype | varchar(200) | false | explicit | False | False |
| toaccount | varchar(5000) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| purpose | varchar(500) | true | implicit_mysql_default | False | False |
| isreconciled | tinyint(1) | false | explicit | False | False |
| issettled | tinyint(1) | false | explicit | False | False |
| settletime | datetime | true | implicit_mysql_default | False | False |
| txtype | varchar(200) | true | implicit_mysql_default | False | False |
| fee | decimal(24,2) | true | implicit_mysql_default | False | False |
| originalreference | varchar(200) | true | implicit_mysql_default | False | False |
| shouldrevert | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `bol_settlement`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| settlement_date | datetime | false | explicit | False | False |
| tx_date | date | false | explicit | False | False |
| sender_reference | varchar(50) | false | explicit | False | False |
| msg_id | varchar(50) | true | implicit_mysql_default | False | False |
| instructing_id | varchar(50) | true | implicit_mysql_default | False | False |
| tx_id | varchar(50) | false | explicit | False | False |
| debtor_bic | varchar(50) | true | implicit_mysql_default | False | False |
| creditor_bic | varchar(50) | true | implicit_mysql_default | False | False |
| dbtr_acc | varchar(50) | true | implicit_mysql_default | False | False |
| cdtr_acc | varchar(50) | true | implicit_mysql_default | False | False |
| trx_type | varchar(255) | true | implicit_mysql_default | False | False |
| sub_trx_type | varchar(255) | true | implicit_mysql_default | False | False |
| group_transactions | int(11) | false | explicit | False | False |
| control_sum | decimal(22,2) | false | explicit | False | False |
| total_amount | decimal(20,2) | false | explicit | False | False |
| ccy | varchar(20) | false | explicit | False | False |
| send_mir | varchar(50) | true | implicit_mysql_default | False | False |
| send_ref | varchar(50) | true | implicit_mysql_default | False | False |
| getupdate_msgnetmir | varchar(50) | true | implicit_mysql_default | False | False |
| getupdate_msguserreference | varchar(50) | true | implicit_mysql_default | False | False |
| settle_result | varchar(255) | false | explicit | False | False |
| settle_result_message | varchar(500) | true | implicit_mysql_default | False | False |
| block4_req_mx_message | text | true | implicit_mysql_default | False | False |
| block4_res_mx_message | text | true | implicit_mysql_default | False | False |
| getupdate_response | text | true | implicit_mysql_default | False | False |
| settle_by | varchar(255) | true | implicit_mysql_default | False | False |
| retry_count | int(11) | true | implicit_mysql_default | False | False |
| is_deleted | tinyint(1) | true | implicit_mysql_default | False | False |
| remark | varchar(255) | true | implicit_mysql_default | False | False |
| file_name | varchar(255) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `bol_settlement_tx_unique_index`: sender_reference asc, tx_id asc
- unique `bol_settlement_adjust_pk`: sender_reference asc, tx_id asc, file_name asc
- index `bol_settlement_file_name_index`: file_name asc
- index `bol_settlement_getupdate_msgnetmir_index`: getupdate_msgnetmir asc
- index `bol_settlement_getupdate_msguserreference_index`: getupdate_msguserreference asc
- index `bol_settlement_is_deleted_index`: is_deleted asc
- index `bol_settlement_send_ref_index`: send_ref asc
- index `bol_settlement_sender_reference_index`: sender_reference asc
- index `bol_settlement_settle_result_index`: settle_result asc
- index `bol_settlement_settlement_date_index`: settlement_date asc
- index `bol_settlement_sub_trx_type_index`: sub_trx_type asc
- index `bol_settlement_trx_type_index`: trx_type asc
- index `bol_settlement_tx_date_index`: tx_date asc
- index `bol_settlement_tx_id_index`: tx_id asc

## Table `bol_settlement_files`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| fid | int(11) | false | primary_key | True | False |
| sender_ref | varchar(50) | false | explicit | False | False |
| txdate | date | false | explicit | False | False |
| block4_request | text | true | implicit_mysql_default | False | False |
| block4_response | text | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: fid asc
- index `bol_settlement_files_sender_ref_index`: sender_ref asc

## Table `bol_settlement_links`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| link_id | varchar(50) | false | primary_key | False | False |
| transaction_type | varchar(100) | false | explicit | False | False |
| report_link | varchar(255) | true | implicit_mysql_default | False | False |
| settlement_link | varchar(255) | false | explicit | False | False |
| has_from_date | tinyint(1) | false | explicit | False | False |
| has_to_date | tinyint(1) | false | explicit | False | False |
| added_datetime | datetime | true | implicit_mysql_default | False | False |
| last_update | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: link_id asc
- index `bol_settle_link_trxn_type`: transaction_type asc

## Table `check_transaction`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| result | varchar(500) | true | implicit_mysql_default | False | False |
| txtime | datetime | false | explicit | False | False |
| txdate | date | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `check_transaction_id_uindex`: id asc
- index `check_transaction__index`: reference asc
- index `check_transaction__index_2`: tomember asc
- index `check_transaction_frommember_index`: frommember asc
- index `check_transaction_result_index`: result asc
- index `check_transaction_txdate_index`: txdate asc
- index `check_transaction_txtime_index`: txtime asc

## Table `crossborder_exchangerate`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ccy | varchar(100) | false | explicit | False | False |
| fromdate | datetime | false | explicit | False | False |
| todate | datetime | true | implicit_mysql_default | False | False |
| lastupdate | datetime | true | implicit_mysql_default | False | False |
| rate | decimal(24,2) | false | explicit | False | False |
| markuprate | decimal(24,2) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| remark | text | true | implicit_mysql_default | False | False |
| frommember | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `crossborder_exchangerate_ccy_index`: ccy asc
- index `crossborder_exchangerate_fromdate_todate_index`: fromdate asc, todate asc
- index `crossborder_exchangerate_lastupdate_index`: lastupdate asc
- index `crossborder_exchangerate_frommember_index`: frommember asc

## Table `crossborder_inquiry`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| txtime | datetime | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |
| exchangerate | decimal(24,2) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `id`: id asc
- unique `reference`: reference asc
- index `crossborder_inquiry_frommember_index`: frommember asc
- index `crossborder_inquiry_result_index`: result(768) asc
- index `crossborder_inquiry_tomember_index`: tomember asc
- index `crossborder_inquiry_txtime_index`: txtime asc

## Table `crossborder_remarks`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| formtype | varchar(50) | true | implicit_mysql_default | False | False |
| referenceid | varchar(200) | true | implicit_mysql_default | False | False |
| datepost | datetime | false | explicit | False | False |
| codetype | varchar(50) | true | implicit_mysql_default | False | False |
| postby | varchar(50) | true | implicit_mysql_default | False | False |
| postagent | varchar(200) | true | implicit_mysql_default | False | False |
| toagent | varchar(200) | true | implicit_mysql_default | False | False |
| remarktype | varchar(50) | true | implicit_mysql_default | False | False |
| remarkdesc | varchar(200) | true | implicit_mysql_default | False | False |
| remarkstatus | varchar(50) | true | implicit_mysql_default | False | False |
| fixby | varchar(50) | true | implicit_mysql_default | False | False |
| fixdate | datetime | true | implicit_mysql_default | False | False |
| fixagent | varchar(150) | true | implicit_mysql_default | False | False |
| fixremark | varchar(200) | true | implicit_mysql_default | False | False |
| adjby | varchar(100) | true | implicit_mysql_default | False | False |
| adjstatus | varchar(100) | true | implicit_mysql_default | False | False |
| adjdate | datetime | true | implicit_mysql_default | False | False |
| adjremark | varchar(200) | true | implicit_mysql_default | False | False |
| adjagent | varchar(100) | true | implicit_mysql_default | False | False |
| checker | varchar(100) | true | implicit_mysql_default | False | False |
| remarkchecker | varchar(200) | true | implicit_mysql_default | False | False |
| checkerstatus | varchar(100) | true | implicit_mysql_default | False | False |
| checkerdate | datetime | true | implicit_mysql_default | False | False |
| iscancelled | int(11) | true | implicit_mysql_default | False | False |
| cancelby | varchar(200) | true | implicit_mysql_default | False | False |
| canceldate | datetime | true | implicit_mysql_default | False | False |
| cancelagent | varchar(100) | true | implicit_mysql_default | False | False |
| cancelremark | varchar(200) | true | implicit_mysql_default | False | False |
| inverifier | varchar(100) | true | implicit_mysql_default | False | False |
| inverifydate | datetime | true | implicit_mysql_default | False | False |
| inverifyagent | varchar(100) | true | implicit_mysql_default | False | False |
| inverifierremark | varchar(200) | true | implicit_mysql_default | False | False |
| inverifystatus | varchar(50) | true | implicit_mysql_default | False | False |
| outverifier | varchar(100) | true | implicit_mysql_default | False | False |
| outverifydate | datetime | true | implicit_mysql_default | False | False |
| outverifyagent | varchar(100) | true | implicit_mysql_default | False | False |
| outverifierremark | varchar(200) | true | implicit_mysql_default | False | False |
| outverifystatus | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc

## Table `crossborder_transfer`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| txtime | datetime | false | explicit | False | False |
| reference | varchar(100) | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |
| exchangerate | decimal(24,2) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| amountccy | varchar(100) | true | implicit_mysql_default | False | False |
| amountlak | decimal(24,2) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `id`: id asc
- unique `reference`: reference asc
- index `crossborder_transfer_frommember_index`: frommember asc
- index `crossborder_transfer_result_index`: result(768) asc
- index `crossborder_transfer_tomember_index`: tomember asc
- index `crossborder_transfer_txtime_index`: txtime asc

## Table `disputes`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| dispute_id | int(11) | false | primary_key | True | False |
| formtype | varchar(50) | true | implicit_mysql_default | False | False |
| referenceid | varchar(200) | true | implicit_mysql_default | False | False |
| postby | varchar(50) | true | implicit_mysql_default | False | False |
| postagent | varchar(200) | true | implicit_mysql_default | False | False |
| toagent | varchar(200) | true | implicit_mysql_default | False | False |
| description | text | true | implicit_mysql_default | False | False |
| iscancelled | int(11) | true | implicit_mysql_default | False | False |
| status | varchar(50) | true | implicit_mysql_default | False | False |
| created_at | timestamptz | true | explicit | False | False |
| updated_at | timestamptz | true | explicit | False | False |
| fixedby | varchar(50) | true | implicit_mysql_default | False | False |
| fixedagent | varchar(20) | true | implicit_mysql_default | False | False |
| frommember | varchar(255) | true | implicit_mysql_default | False | False |
| tomember | varchar(255) | true | implicit_mysql_default | False | False |
| amount | decimal(15,2) | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| transaction_date | date | true | implicit_mysql_default | False | False |
| direction | varchar(150) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: dispute_id asc

## Table `dispute_attachments`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| attachment_id | int(11) | false | primary_key | True | False |
| message_id | int(11) | true | implicit_mysql_default | False | False |
| file_name | varchar(255) | true | implicit_mysql_default | False | False |
| status | int(11) | true | implicit_mysql_default | False | False |
| uploaded_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: attachment_id asc
- index `message_id`: message_id asc
- foreign key `dispute_attachments_ibfk_1`: (message_id) -> `dispute_messages` (message_id); ON DELETE CASCADE

## Table `dispute_messages`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| message_id | int(11) | false | primary_key | True | False |
| dispute_id | int(11) | true | implicit_mysql_default | False | False |
| sender | varchar(50) | true | implicit_mysql_default | False | False |
| agentid | varchar(50) | true | implicit_mysql_default | False | False |
| message | text | true | implicit_mysql_default | False | False |
| created_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: message_id asc

## Table `ecny_icomming_file_transactions`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | ubigint(20) | false | primary_key | True | False |
| txn_complete_time | datetime(3) | false | explicit | False | False |
| msg_ref_no | varchar(64) | false | explicit | False | False |
| msg_identifier_no | varchar(64) | false | explicit | False | False |
| lapnet_wallet_inst_code | varchar(32) | false | explicit | False | False |
| cn_merchant_inst_code | varchar(32) | true | implicit_mysql_default | False | False |
| ecny_fin_inst_code | varchar(32) | false | explicit | False | False |
| ecny_currency_code | varchar(3) | false | explicit | False | False |
| ecny_amount | decimal(18,2) | false | explicit | False | False |
| fx_currency_code | varchar(3) | false | explicit | False | False |
| fx_amount | decimal(18,2) | true | implicit_mysql_default | False | False |
| exchange_rate | decimal(20,10) | true | implicit_mysql_default | False | False |
| platform_order_no | varchar(64) | true | implicit_mysql_default | False | False |
| merchant_order_no | varchar(64) | false | explicit | False | False |
| platform_refund_no | varchar(64) | true | implicit_mysql_default | False | False |
| merchant_refund_no | varchar(64) | true | implicit_mysql_default | False | False |
| txn_status | varchar(16) | false | explicit | False | False |
| txn_description | varchar(255) | true | implicit_mysql_default | False | False |
| created_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uk_msg_ref_identifier`: msg_ref_no asc, msg_identifier_no asc
- index `idx_msg_identifier`: msg_identifier_no asc
- index `idx_txn_complete_time`: txn_complete_time asc
- index `idx_merchant_order_no`: merchant_order_no asc
- index `idx_txn_status`: txn_status asc

## Table `electricity_payment`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | explicit | False | False |
| bankreference | varchar(100) | false | explicit | False | False |
| bankdate | varchar(100) | false | explicit | False | False |
| transfertype | varchar(100) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| responsetime | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `electricity_payment_bankdate_bankreference_reference_uindex`: bankdate asc, bankreference asc, reference asc
- index `electricity_payment_bankdate_index`: bankdate asc
- index `electricity_payment_bankreference_index`: bankreference asc
- index `electricity_payment_reference_index`: reference asc

## Table `extra_limit`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| limittype | varchar(100) | false | explicit | False | False |
| amount | decimal(24,0) | false | explicit | False | False |
| ccy | varchar(10) | false | explicit | False | False |
| status | varchar(10) | false | explicit | False | False |
| lastupdate | datetime | false | explicit | False | False |
| userid | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `extra_limit_id_uindex`: id asc
- index `extra_limit_frommember_tomember_ccy_status_limittype_index`: frommember asc, tomember asc, ccy asc, status asc, limittype asc

## Table `fee`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ccy | varchar(3) | true | implicit_mysql_default | False | False |
| feetype | varchar(16) | true | implicit_mysql_default | False | False |
| fromamount | decimal(20,2) | true | implicit_mysql_default | False | False |
| feeamount | decimal(20,2) | true | implicit_mysql_default | False | False |
| feepercent | decimal(20,2) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `fee_feeamount_index`: feeamount asc
- index `fee_feetype_index`: feetype asc
- index `fee_ccy_index`: ccy asc

## Table `fee002`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| txtime | datetime | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| path | varchar(500) | false | explicit | False | False |
| request | longtext | false | explicit | False | False |
| response | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(100) | true | implicit_mysql_default | False | False |
| reference | varchar(200) | false | explicit | False | False |

Declared keys/indexes:

- unique `reference`: reference asc
- index `fee002_frommember_index`: frommember asc
- index `fee002_path_index`: path asc
- index `fee002_result_index`: result asc
- index `fee002_txtime_index`: txtime asc

## Table `fee_promotion`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ccy | varchar(3) | true | implicit_mysql_default | False | False |
| feetype | varchar(16) | true | implicit_mysql_default | False | False |
| fromamount | bigint(20) | true | implicit_mysql_default | False | False |
| feeamount | int(11) | true | implicit_mysql_default | False | False |
| is_active | tinyint(4) | true | implicit_mysql_default | False | False |
| insert_date | datetime | true | implicit_mysql_default | False | False |
| fee_note | varchar(256) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `fee_pro_feeamount_index`: feeamount asc
- index `fee_pro_feetype_index`: feetype asc, ccy asc, is_active asc

## Table `finlink_cancel_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| canceltime | datetime | true | implicit_mysql_default | False | False |
| reference | varchar(50) | true | implicit_mysql_default | False | False |
| cancelby | varchar(100) | false | explicit | False | False |
| reason | varchar(255) | true | implicit_mysql_default | False | False |
| servicename | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- index `finlink_cancel_log_reference_index`: reference asc

## Table `finlink_feecode`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| finlink_feecode | varchar(50) | true | implicit_mysql_default | False | False |
| app_feecode | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc

## Table `finlink_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| txtime | datetime | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| rawrequest | text | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| rawresponse | text | true | implicit_mysql_default | False | False |
| id | varchar(200) | true | implicit_mysql_default | False | False |
| type | varchar(100) | true | implicit_mysql_default | False | False |
| txdate | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `finlink_log_frommember_tomember_reference_type_uindex`: frommember asc, tomember asc, reference asc, type asc
- index `finlink_log_frommember_index`: frommember asc
- index `finlink_log_tomember_index`: tomember asc
- index `finlink_log_txtime_index`: txtime asc
- index `finlink_log_reference_index`: reference asc
- index `finlink_log_id_index`: id asc
- index `finlink_log_type_index`: type asc
- index `finlink_log_txdate_index`: txdate asc
- index `finlink_log_rawrequest_index`: rawrequest(768) asc

## Table `finlink_temp`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| product | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `finlink_temp_pk`: reference asc

## Table `finlink_transit_acc_movement`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ref | varchar(100) | true | implicit_mysql_default | False | False |
| amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| frommember | varchar(10) | true | implicit_mysql_default | False | False |
| txndate | date | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| settledate | datetime | true | implicit_mysql_default | False | False |
| trvf_amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| police_amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| office_code | varchar(10) | true | implicit_mysql_default | False | False |
| sent | int(11) | true | implicit_mysql_default | False | False |
| sent_time | datetime | true | implicit_mysql_default | False | False |
| response | varchar(2000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `ref`: ref asc

## Table `finlink_transit_items`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| reference | varchar(50) | true | implicit_mysql_default | False | False |
| feecode | varchar(50) | true | implicit_mysql_default | False | False |
| feecode_desc | varchar(100) | true | implicit_mysql_default | False | False |
| total_amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| total_qty | int(11) | true | implicit_mysql_default | False | False |
| requesttime | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc

## Table `finlink_travelfee_settlement`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ref | varchar(100) | true | implicit_mysql_default | False | False |
| amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| frommember | varchar(10) | true | implicit_mysql_default | False | False |
| txndate | date | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| settledate | datetime | true | implicit_mysql_default | False | False |
| trvf_amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| police_amount | decimal(10,0) | true | implicit_mysql_default | False | False |
| office_code | varchar(10) | true | implicit_mysql_default | False | False |
| sent | int(11) | true | implicit_mysql_default | False | False |
| sent_time | datetime | true | implicit_mysql_default | False | False |
| response | varchar(2000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `finlink_travelfee_settlement_pk`: ref asc

## Table `finpass_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| txtime | datetime | false | explicit | False | False |
| checkpoint | varchar(100) | true | implicit_mysql_default | False | False |
| reference | varchar(100) | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| type | varchar(100) | true | implicit_mysql_default | False | False |
| transactiontype | varchar(100) | false | explicit | False | False |
| bankreference | varchar(100) | true | implicit_mysql_default | False | False |
| declarations | longtext | true | implicit_mysql_default | False | False |
| rawrequest | longtext | true | implicit_mysql_default | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| transferid | bigint(20) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `finpass_log_bankreference_index`: bankreference asc
- index `finpass_log_checkpoint_index`: checkpoint asc
- index `finpass_log_frommember_index`: frommember asc
- index `finpass_log_id_index`: id asc
- index `finpass_log_txtime_index`: txtime asc
- index `finpass_log_reference_frommember_uindex`: reference asc

## Table `inquiry`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | primary_key | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| fromuser | varchar(200) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(200) | true | implicit_mysql_default | False | False |
| totype | varchar(200) | true | implicit_mysql_default | False | False |
| toaccount | varchar(5000) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| accountname | varchar(200) | true | implicit_mysql_default | False | False |
| accountlocation | varchar(300) | true | implicit_mysql_default | False | False |
| accountphone | varchar(200) | true | implicit_mysql_default | False | False |
| accountccy | varchar(200) | true | implicit_mysql_default | False | False |
| invoice | varchar(200) | true | implicit_mysql_default | False | False |
| terminal | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| purpose | varchar(1000) | true | implicit_mysql_default | False | False |
| purposerequired | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| fromchannel | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc, requesttime asc
- unique `idx_unq_inquiry_reference_pk`: reference asc, requesttime asc
- index `idx1_inquiry`: frommember asc
- index `idx2_inquiry`: tomember asc
- index `idx3_inquiry`: requesttime asc
- index `idx4_inquiry`: responsetime asc
- index `idx5_inquiry`: result asc
- index `idx6_inquiry`: result asc, txtime asc, frommember asc, tomember asc

## Table `inquiryiso`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| request | varchar(5000) | true | implicit_mysql_default | False | False |
| response | varchar(5000) | true | implicit_mysql_default | False | False |
| txtime | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `inquiryiso_reference_frommember_tomember_uindex`: reference asc, frommember asc, tomember asc
- index `inquiryiso_frommember_index`: frommember asc
- index `inquiryiso_reference_index`: reference asc
- index `inquiryiso_tomember_index`: tomember asc
- index `inquiryiso_txtime_index`: txtime asc

## Table `inquiry_hist`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | primary_key | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| fromuser | varchar(200) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(200) | true | implicit_mysql_default | False | False |
| totype | varchar(200) | true | implicit_mysql_default | False | False |
| toaccount | varchar(5000) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| accountname | varchar(200) | true | implicit_mysql_default | False | False |
| accountlocation | varchar(300) | true | implicit_mysql_default | False | False |
| accountphone | varchar(200) | true | implicit_mysql_default | False | False |
| accountccy | varchar(200) | true | implicit_mysql_default | False | False |
| invoice | varchar(200) | true | implicit_mysql_default | False | False |
| terminal | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| purpose | varchar(1000) | true | implicit_mysql_default | False | False |
| purposerequired | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc, requesttime asc
- unique `idx_unq_inquiry_reference_pk`: reference asc, requesttime asc
- index `idx1_inquiry_hist`: frommember asc
- index `idx2_inquiry_hist`: tomember asc
- index `idx3_inquiry_hist`: requesttime asc
- index `idx4_inquiry_hist`: responsetime asc
- index `idx5_inquiry_hist`: result asc

## Table `inquiry_old`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | true | implicit_mysql_default | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| frommember | varchar(200) | true | implicit_mysql_default | False | False |
| fromuser | varchar(200) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(200) | true | implicit_mysql_default | False | False |
| totype | varchar(200) | true | implicit_mysql_default | False | False |
| toaccount | varchar(5000) | true | implicit_mysql_default | False | False |
| tomember | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| accountname | varchar(200) | true | implicit_mysql_default | False | False |
| accountlocation | varchar(300) | true | implicit_mysql_default | False | False |
| accountphone | varchar(200) | true | implicit_mysql_default | False | False |
| accountccy | varchar(200) | true | implicit_mysql_default | False | False |
| invoice | varchar(200) | true | implicit_mysql_default | False | False |
| terminal | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | true | implicit_mysql_default | False | False |
| purpose | varchar(1000) | true | implicit_mysql_default | False | False |
| purposerequired | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `inquiry_reference_pk`: reference asc
- index `inquiry_frommember_index`: frommember asc
- index `inquiry_tomember_index`: tomember asc
- index `inquiry_requesttime_index`: requesttime asc
- index `inquiry_responsetime_index`: responsetime asc
- index `inquiry_result_index`: result asc

## Table `inquiry_reference`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(200) | false | primary_key | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc

## Table `itmx_acknowledge`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| ackid | int(11) | false | primary_key | True | False |
| type | varchar(100) | true | implicit_mysql_default | False | False |
| settledate | datetime | true | implicit_mysql_default | False | False |
| title | varchar(100) | true | implicit_mysql_default | False | False |
| total_cnt | int(11) | true | implicit_mysql_default | False | False |
| total_success | int(11) | true | implicit_mysql_default | False | False |
| total_reject | int(11) | true | implicit_mysql_default | False | False |
| uploadby | varchar(100) | true | implicit_mysql_default | False | False |
| uploaddate | datetime | true | implicit_mysql_default | False | False |
| upstatus | int(11) | true | implicit_mysql_default | False | False |
| remark | varchar(200) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: ackid asc

## Table `itmx_acknowledge_details`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| ackid | int(11) | true | implicit_mysql_default | False | False |
| rejectcode | varchar(100) | true | implicit_mysql_default | False | False |
| rescode | varchar(100) | true | implicit_mysql_default | False | False |
| fromacc | varchar(100) | true | implicit_mysql_default | False | False |
| toacc | varchar(100) | true | implicit_mysql_default | False | False |
| settledate | date | true | implicit_mysql_default | False | False |
| amount | double | true | implicit_mysql_default | False | False |
| ccy | varchar(10) | true | implicit_mysql_default | False | False |
| instrid | varchar(200) | true | implicit_mysql_default | False | False |
| merchantid | varchar(100) | true | implicit_mysql_default | False | False |
| merchantname | varchar(200) | true | implicit_mysql_default | False | False |
| retrvrefno | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `itmx_acknowledge_details_id_uindex`: id asc

## Table `itmx_adjustment`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| type | varchar(50) | true | implicit_mysql_default | False | False |
| settledate | date | true | implicit_mysql_default | False | False |
| title | varchar(100) | true | implicit_mysql_default | False | False |
| total_cnt | int(11) | true | implicit_mysql_default | False | False |
| total_amt | double | true | implicit_mysql_default | False | False |
| uploadby | varchar(50) | true | implicit_mysql_default | False | False |
| uploaddate | datetime | true | implicit_mysql_default | False | False |
| upstatus | int(11) | true | implicit_mysql_default | False | False |
| remark | varchar(200) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `item_adjustment_id_uindex`: id asc
- index `idx_settledate`: settledate asc
- index `idx_settledate_adjustment`: settledate asc

## Table `itmx_adjustment_detail`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| adjid | int(11) | true | implicit_mysql_default | False | False |
| adjtype | varchar(10) | true | implicit_mysql_default | False | False |
| settledate | date | true | implicit_mysql_default | False | False |
| replydate | datetime | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| txttype | varchar(10) | true | implicit_mysql_default | False | False |
| direction | varchar(10) | true | implicit_mysql_default | False | False |
| frombank | varchar(100) | true | implicit_mysql_default | False | False |
| tobank | varchar(100) | true | implicit_mysql_default | False | False |
| refundccy | varchar(10) | true | implicit_mysql_default | False | False |
| refundamt | double | true | implicit_mysql_default | False | False |
| fromacc | varchar(100) | true | implicit_mysql_default | False | False |
| toacc | varchar(100) | true | implicit_mysql_default | False | False |
| originator | varchar(100) | true | implicit_mysql_default | False | False |
| receiptid | varchar(100) | true | implicit_mysql_default | False | False |
| instructionid | varchar(100) | true | implicit_mysql_default | False | False |
| remark | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `itmx_adjustment_detail_id_uindex`: id asc
- index `itmx_adjustment_detail_settledate_index`: settledate asc
- index `itmx_adjustment_detail_instructionid_index`: instructionid asc

## Table `itmx_dailysettlement`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| dsid | int(11) | false | auto_increment | True | False |
| type | varchar(100) | true | implicit_mysql_default | False | False |
| settledate | datetime | true | implicit_mysql_default | False | False |
| title | varchar(500) | true | implicit_mysql_default | False | False |
| total_cnt | int(11) | true | implicit_mysql_default | False | False |
| total_amt | double | true | implicit_mysql_default | False | False |
| uploadby | varchar(100) | true | implicit_mysql_default | False | False |
| uploaddate | datetime | true | implicit_mysql_default | False | False |
| upstatus | int(11) | true | implicit_mysql_default | False | False |
| remark | text | true | implicit_mysql_default | False | False |
| processdate | datetime | true | implicit_mysql_default | False | False |
| settlementbank | varchar(50) | true | implicit_mysql_default | False | False |
| cscanb | double | true | implicit_mysql_default | False | False |
| fee | double | true | implicit_mysql_default | False | False |
| void | double | true | implicit_mysql_default | False | False |
| adjustment | double | true | implicit_mysql_default | False | False |
| refund | double | true | implicit_mysql_default | False | False |
| intfee | double | true | implicit_mysql_default | False | False |
| ccy | varchar(10) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `itmx_dailysettlement_dsid_uindex`: dsid asc
- index `idx_settledate_dailysettlement`: settledate asc
- index `itmx_dailysettlement_type_index`: type asc

## Table `itmx_dailysettlement_details`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | auto_increment | True | False |
| dsid | int(11) | true | implicit_mysql_default | False | False |
| rescode | varchar(100) | true | implicit_mysql_default | False | False |
| fromacc | varchar(100) | true | implicit_mysql_default | False | False |
| toacc | varchar(100) | true | implicit_mysql_default | False | False |
| settledate | datetime | true | implicit_mysql_default | False | False |
| amount | double | true | implicit_mysql_default | False | False |
| ccy | varchar(10) | true | implicit_mysql_default | False | False |
| instrid | varchar(200) | true | implicit_mysql_default | False | False |
| merchantid | varchar(100) | true | implicit_mysql_default | False | False |
| merchantname | varchar(200) | true | implicit_mysql_default | False | False |
| retrvrefno | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `itmx_dailysettlement_details_id_uindex`: id asc
- index `instrid`: instrid asc

## Table `itmx_file_transaction`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| txtime | datetime | true | implicit_mysql_default | False | False |
| col1 | varchar(1000) | true | implicit_mysql_default | False | False |
| col2 | varchar(1000) | true | implicit_mysql_default | False | False |
| col3 | varchar(1000) | true | implicit_mysql_default | False | False |
| col4 | varchar(1000) | true | implicit_mysql_default | False | False |
| col5 | varchar(1000) | true | implicit_mysql_default | False | False |
| col6 | varchar(1000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `itmx_settlement_summary`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| settledate | date | true | implicit_mysql_default | False | False |
| processdate | date | true | implicit_mysql_default | False | False |
| settlecode | varchar(20) | true | implicit_mysql_default | False | False |
| settlebank | varchar(50) | true | implicit_mysql_default | False | False |
| amount | double | true | implicit_mysql_default | False | False |
| fee | double | true | implicit_mysql_default | False | False |
| void | double | true | implicit_mysql_default | False | False |
| adjustment | double | true | implicit_mysql_default | False | False |
| refund | double | true | implicit_mysql_default | False | False |
| intfee | double | true | implicit_mysql_default | False | False |
| total | double | true | implicit_mysql_default | False | False |
| uploaddate | datetime | true | implicit_mysql_default | False | False |
| uploadby | varchar(50) | true | implicit_mysql_default | False | False |
| uploadstatus | int(11) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `itmx_settlement_summary_id_uindex`: id asc

## Table `itmx_unmatch`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| unid | int(11) | false | auto_increment | True | False |
| type | varchar(100) | true | implicit_mysql_default | False | False |
| atdate | date | true | implicit_mysql_default | False | False |
| processdate | datetime | true | implicit_mysql_default | False | False |
| adj_payable_cnt | varchar(50) | true | implicit_mysql_default | False | False |
| adj_payable_amt_thb | varchar(50) | true | implicit_mysql_default | False | False |
| adj_payable_amt_lak | varchar(50) | true | implicit_mysql_default | False | False |
| adj_payable_fee_thb | varchar(50) | true | implicit_mysql_default | False | False |
| adj_payable_fee_lak | varchar(50) | true | implicit_mysql_default | False | False |
| adj_receivable_cnt | varchar(50) | true | implicit_mysql_default | False | False |
| adj_receivable_amt_thb | varchar(50) | true | implicit_mysql_default | False | False |
| adj_receivable_amt_lak | varchar(50) | true | implicit_mysql_default | False | False |
| adj_receivable_fee_thb | varchar(50) | true | implicit_mysql_default | False | False |
| adj_receivable_fee_lak | varchar(50) | true | implicit_mysql_default | False | False |
| netadj_cnt | varchar(50) | true | implicit_mysql_default | False | False |
| netadj_amt_thb | varchar(50) | true | implicit_mysql_default | False | False |
| netadj_amt_lak | varchar(50) | true | implicit_mysql_default | False | False |
| netadj_fee_thb | varchar(50) | true | implicit_mysql_default | False | False |
| netadj_fee_lak | varchar(50) | true | implicit_mysql_default | False | False |
| netinvest_cnt | varchar(50) | true | implicit_mysql_default | False | False |
| netinvest_amt_thb | varchar(50) | true | implicit_mysql_default | False | False |
| netinvest_amt_lak | varchar(50) | true | implicit_mysql_default | False | False |
| netinvest_fee_thb | varchar(50) | true | implicit_mysql_default | False | False |
| netinvest_fee_lak | varchar(50) | true | implicit_mysql_default | False | False |
| total_macth_cnt | varchar(50) | true | implicit_mysql_default | False | False |
| total_match_amt_thb | varchar(50) | true | implicit_mysql_default | False | False |
| total_match_amt_lak | varchar(50) | true | implicit_mysql_default | False | False |
| total_match_fee_thb | varchar(50) | true | implicit_mysql_default | False | False |
| total_match_fee_lak | varchar(50) | true | implicit_mysql_default | False | False |
| uploadby | varchar(100) | true | implicit_mysql_default | False | False |
| uploaddate | datetime | true | implicit_mysql_default | False | False |
| upstatus | int(11) | true | implicit_mysql_default | False | False |
| rawdata | longtext | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `itmx_unmatch_unid_uindex`: unid asc
- index `idx_atdate_unmatch`: atdate asc
- index `itmx_unmatch_type_index`: type asc

## Table `itmx_unmatchfixer_error`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| processdatetime | datetime | true | implicit_mysql_default | False | False |
| processdate | date | true | implicit_mysql_default | False | False |
| instructionid | varchar(50) | true | implicit_mysql_default | False | False |
| result | varchar(255) | true | implicit_mysql_default | False | False |
| status | varchar(10) | true | implicit_mysql_default | False | False |
| fixmethod | varchar(10) | true | implicit_mysql_default | False | False |
| fixby | varchar(25) | true | implicit_mysql_default | False | False |
| fixdatetime | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- index `itmx_unmatchfixer_error_instructionid_index`: instructionid asc
- index `itmx_unmatchfixer_error_processdate_index`: processdate asc
- index `itmx_unmatchfixer_error_status_index`: status asc

## Table `itmx_unmatchfixer_schedule`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| lastcheckdate | date | true | implicit_mysql_default | False | False |
| lastsettledate | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `itmx_unmatch_details`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | auto_increment | True | False |
| unmatch_id | int(11) | true | implicit_mysql_default | False | False |
| tobank | varchar(10) | true | implicit_mysql_default | False | False |
| txtdate | datetime | true | implicit_mysql_default | False | False |
| instid | varchar(50) | true | implicit_mysql_default | False | False |
| fromacc_code | varchar(30) | true | implicit_mysql_default | False | False |
| fromacc | varchar(50) | true | implicit_mysql_default | False | False |
| toacc_code | varchar(30) | true | implicit_mysql_default | False | False |
| toacc | varchar(50) | true | implicit_mysql_default | False | False |
| amount | double | true | implicit_mysql_default | False | False |
| reasoncode | varchar(30) | true | implicit_mysql_default | False | False |
| remark | text | true | implicit_mysql_default | False | False |
| type | varchar(30) | true | implicit_mysql_default | False | False |
| ustatus | int(11) | true | implicit_mysql_default | False | False |
| senderamt_thb | double | true | implicit_mysql_default | False | False |
| senderamt_lak | double | true | implicit_mysql_default | False | False |
| itmxamt_thb | double | true | implicit_mysql_default | False | False |
| itmxamt_lak | double | true | implicit_mysql_default | False | False |
| receiveramt_thb | double | true | implicit_mysql_default | False | False |
| receiveramt_lak | double | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `itmx_unmatch_details_unmatch_id_uindex`: id asc
- index `idx_instid`: instid asc
- index `itmx_unmatch_details_reasoncode_index`: reasoncode asc
- index `itmx_unmatch_details_unmatch_id_index`: unmatch_id asc

## Table `landtax_inquiry`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc
- index `landtax_inquiry_frommember_index`: frommember asc
- index `landtax_inquiry_result_index`: result(768) asc
- index `landtax_inquiry_txtime_index`: txtime asc

## Table `landtax_payment`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | primary_key | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |
| totaltaxamount | decimal(24,2) | false | explicit | False | False |
| issettled | tinyint(4) | false | explicit | False | False |
| provinceid | varchar(100) | false | explicit | False | False |
| districtid | varchar(100) | false | explicit | False | False |
| villageid | varchar(100) | true | implicit_mysql_default | False | False |
| taxyear | int(11) | false | explicit | False | False |
| fromuser | varchar(1000) | false | explicit | False | False |
| fromaccount | varchar(1000) | false | explicit | False | False |
| totalfineamount | decimal(24,2) | false | explicit | False | False |
| documentid | varchar(500) | false | explicit | False | False |
| bankreceiptnumber | varchar(500) | false | explicit | False | False |
| statementdatetime | varchar(100) | true | implicit_mysql_default | False | False |
| statementdate | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc
- index `landtax_payment_frommember_index`: frommember asc
- index `landtax_payment_txtime_index`: txtime asc
- index `bankreceiptnumber`: bankreceiptnumber asc
- index `landtax_payment_result_index`: result(768) asc

## Table `lmps_transfer_count`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| frommember | varchar(200) | false | primary_key | False | False |
| fromaccount | varchar(200) | false | primary_key | False | False |
| totype | varchar(200) | false | primary_key | False | False |
| qrtype | varchar(100) | false | primary_key | False | False |
| monthly | int(11) | false | primary_key | False | False |
| monthly_count | int(11) | true | implicit_mysql_default | False | False |
| total_amount | decimal(24,2) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: frommember asc, fromaccount asc, totype asc, qrtype asc, monthly asc
- index `lmps_transfer_history_index`: frommember asc, fromaccount asc, monthly asc

## Table `log_20260311`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| ID | varchar(50) | false | explicit | False | False |
| memberbank_txtime | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `log_20260311_pk`: ID asc

## Table `member`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| code | varchar(100) | false | primary_key | False | False |
| iin | varchar(100) | false | explicit | False | False |
| name | varchar(500) | false | explicit | False | False |
| publickey | varchar(5000) | true | implicit_mysql_default | False | False |
| inquiryurl | varchar(1000) | true | implicit_mysql_default | False | False |
| transferurl | varchar(1000) | true | implicit_mysql_default | False | False |
| notifyurl | varchar(1000) | true | implicit_mysql_default | False | False |
| rtgscode | varchar(32) | true | implicit_mysql_default | False | False |
| rtgsaccount | varchar(32) | true | implicit_mysql_default | False | False |
| status | varchar(16) | true | implicit_mysql_default | False | False |
| crossbordersettlementbank | varchar(500) | true | implicit_mysql_default | False | False |
| COUNTRYCODE | varchar(2) | true | implicit_mysql_default | False | False |
| settlefinlink | int(11) | true | implicit_mysql_default | False | False |
| rtgsthbaccount | varchar(32) | true | implicit_mysql_default | False | False |
| rtgsthbcode | varchar(32) | true | implicit_mysql_default | False | False |
| rtgsusdaccount | varchar(20) | true | implicit_mysql_default | False | False |
| rtgsusdcode | varchar(10) | true | implicit_mysql_default | False | False |
| ismulticurrency | int(11) | true | implicit_mysql_default | False | False |
| rtgscnyaccount | varchar(20) | true | implicit_mysql_default | False | False |
| rtgscnycode | varchar(20) | true | implicit_mysql_default | False | False |
| crossborder_inbound | text | true | implicit_mysql_default | False | False |
| crossborder_outbound | text | true | implicit_mysql_default | False | False |
| retransferurl | varchar(1000) | true | implicit_mysql_default | False | False |
| member_type | varchar(20) | true | implicit_mysql_default | False | False |
| member_fullname | varchar(100) | true | implicit_mysql_default | False | False |
| messageformat | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: code asc
- index `member_name_index`: name asc

## Table `memberblock`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| fromtime | datetime | false | explicit | False | False |
| totime | datetime | false | explicit | False | False |
| deleted | tinyint(1) | false | explicit | False | False |
| deletedtime | datetime | true | implicit_mysql_default | False | False |
| userid | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `memberblock_deleted_index`: deleted asc
- index `memberblock_frommember_index`: frommember asc
- index `memberblock_fromtime_index`: fromtime asc
- index `memberblock_tomember_index`: tomember asc
- index `memberblock_totime_index`: totime asc

## Table `memberdown`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| membercode | varchar(100) | false | explicit | False | False |
| fromtime | datetime | false | explicit | False | False |
| totime | datetime | false | explicit | False | False |
| deleted | tinyint(4) | false | explicit | False | False |
| deletedtime | date | true | implicit_mysql_default | False | False |
| userid | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `memberdown_deleted_index`: deleted asc
- index `memberdown_fromtime_index`: fromtime asc
- index `memberdown_membercode_index`: membercode asc
- index `memberdown_totime_index`: totime asc

## Table `membermulticcy`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| code | varchar(100) | false | explicit | False | False |
| userid | varchar(100) | false | explicit | False | False |
| addedtime | date | false | explicit | False | False |
| status | varchar(100) | false | explicit | False | False |
| deletedtime | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `membermulticcy_code_uindex`: code asc
- unique `membermulticcy_id_uindex`: id asc
- index `membermulticcy_status_index`: status asc

## Table `notify`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| requesttime | datetime | true | implicit_mysql_default | False | False |
| reference | varchar(200) | true | implicit_mysql_default | False | False |
| requestresult | varchar(200) | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `pushtransfer`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| txtime | datetime | false | explicit | False | False |
| reference | varchar(100) | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `pushtransfer_frommember_index`: frommember asc
- index `pushtransfer_id_index`: id asc
- index `pushtransfer_reference_index`: reference asc
- index `pushtransfer_result_index`: result asc
- index `pushtransfer_tomember_index`: tomember asc
- index `pushtransfer_txtime_index`: txtime asc

## Table `qrtype`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| code | varchar(100) | false | explicit | False | False |
| name | varchar(200) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `qrtype_code_uindex`: code asc

## Table `remarks`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| formtype | varchar(50) | true | implicit_mysql_default | False | False |
| referenceid | varchar(200) | true | implicit_mysql_default | False | False |
| datepost | datetime | false | explicit | False | False |
| postby | varchar(50) | true | implicit_mysql_default | False | False |
| postagent | varchar(200) | true | implicit_mysql_default | False | False |
| toagent | varchar(200) | true | implicit_mysql_default | False | False |
| remarktype | varchar(50) | true | implicit_mysql_default | False | False |
| remarkdesc | varchar(500) | true | implicit_mysql_default | False | False |
| remarkstatus | varchar(50) | true | implicit_mysql_default | False | False |
| fixby | varchar(50) | true | implicit_mysql_default | False | False |
| fixdate | datetime | true | implicit_mysql_default | False | False |
| fixagent | varchar(150) | true | implicit_mysql_default | False | False |
| fixremark | varchar(200) | true | implicit_mysql_default | False | False |
| adjby | varchar(100) | true | implicit_mysql_default | False | False |
| adjstatus | varchar(100) | true | implicit_mysql_default | False | False |
| adjdate | datetime | true | implicit_mysql_default | False | False |
| adjremark | varchar(200) | true | implicit_mysql_default | False | False |
| adjagent | varchar(100) | true | implicit_mysql_default | False | False |
| checker | varchar(100) | true | implicit_mysql_default | False | False |
| remarkchecker | varchar(200) | true | implicit_mysql_default | False | False |
| checkerstatus | varchar(100) | true | implicit_mysql_default | False | False |
| checkerdate | datetime | true | implicit_mysql_default | False | False |
| iscancelled | int(11) | true | implicit_mysql_default | False | False |
| cancelby | varchar(200) | true | implicit_mysql_default | False | False |
| canceldate | datetime | true | implicit_mysql_default | False | False |
| cancelagent | varchar(100) | true | implicit_mysql_default | False | False |
| cancelremark | varchar(200) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `remarks_userid_index`: postby asc
- index `remarks_txtime_index`: datepost asc
- index `remarks_remark_index`: remarktype asc
- index `idx_remarks_referenceid`: referenceid asc
- index `idx_remarks_opt`: remarktype asc, remarkstatus asc, iscancelled asc, referenceid asc
- index `idx_remarks_toagent`: toagent asc, remarkstatus asc, iscancelled asc
- index `idx_remarks_postagent`: postagent asc, remarkstatus asc, iscancelled asc
- index `idx_remarks_canceldate`: canceldate asc, iscancelled asc

## Table `resultmodifyhistory`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| txtime | datetime | true | implicit_mysql_default | False | False |
| reference | varchar(100) | true | implicit_mysql_default | False | False |
| fromresult | varchar(100) | true | implicit_mysql_default | False | False |
| toresult | varchar(100) | true | implicit_mysql_default | False | False |
| username | varchar(100) | true | implicit_mysql_default | False | False |
| remark | varchar(1000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `roadtax_inquiry`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(200) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc
- index `roadtax_inquiry_frommember_index`: frommember asc
- index `roadtax_inquiry_result_index`: result(768) asc
- index `roadtax_inquiry_txtime_index`: txtime asc

## Table `roadtax_payment`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(200) | false | primary_key | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| rawrequest | longtext | false | explicit | False | False |
| rawresponse | longtext | true | implicit_mysql_default | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(1000) | true | implicit_mysql_default | False | False |
| taxamount | decimal(24,2) | true | implicit_mysql_default | False | False |
| fineamount | decimal(24,2) | true | implicit_mysql_default | False | False |
| issettled | tinyint(4) | false | explicit | False | False |
| provincecode | varchar(100) | false | explicit | False | False |
| plattypecode | varchar(100) | false | explicit | False | False |
| plattypename | varchar(1000) | false | explicit | False | False |
| vehicletype | varchar(100) | false | explicit | False | False |
| paymentyear | int(11) | false | explicit | False | False |
| fromuser | varchar(1000) | false | explicit | False | False |
| contactnumber | varchar(1000) | false | explicit | False | False |
| barcode | varchar(1000) | false | explicit | False | False |
| brand | varchar(1000) | false | explicit | False | False |
| model | varchar(1000) | true | implicit_mysql_default | False | False |
| engineno | varchar(2000) | true | implicit_mysql_default | False | False |
| chasisno | varchar(2000) | false | explicit | False | False |
| bankreceiptnumber | varchar(100) | false | explicit | False | False |
| platno | varchar(200) | false | explicit | False | False |
| statementdate | varchar(100) | true | implicit_mysql_default | False | False |
| transfertype | varchar(100) | true | implicit_mysql_default | False | False |
| statementdatetime | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc
- index `roadtax_payment_bankreceiptnumber_index`: bankreceiptnumber asc
- index `roadtax_payment_barcode_index`: barcode(768) asc
- index `roadtax_payment_frommember_index`: frommember asc
- index `roadtax_payment_fromuser_index`: fromuser(768) asc
- index `roadtax_payment_platno_index`: platno asc
- index `roadtax_payment_provincecode_index`: provincecode asc
- index `roadtax_payment_purposecode_index`: plattypecode asc
- index `roadtax_payment_result_index`: result(768) asc
- index `roadtax_payment_txtime_index`: txtime asc
- index `roadtax_payment_vehicletype_index`: vehicletype asc

## Table `rtgs_limis_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| rtgs_txnid | varchar(100) | false | explicit | False | False |
| requestdatetime | datetime | true | implicit_mysql_default | False | False |
| lifmis_request | varchar(2000) | false | explicit | False | False |
| lifmis_response | varchar(2000) | true | implicit_mysql_default | False | False |
| amount | decimal(20,2) | true | implicit_mysql_default | False | False |
| sourceacc | varchar(100) | true | implicit_mysql_default | False | False |
| destacc | varchar(100) | true | implicit_mysql_default | False | False |
| ccy | varchar(5) | true | implicit_mysql_default | False | False |
| sourcebankcode | varchar(100) | true | implicit_mysql_default | False | False |
| destbankcode | varchar(100) | true | implicit_mysql_default | False | False |
| product | varchar(50) | true | implicit_mysql_default | False | False |
| txndate | date | true | implicit_mysql_default | False | False |
| bank | varchar(20) | true | implicit_mysql_default | False | False |
| sent | int(11) | true | implicit_mysql_default | False | False |
| lifmis_process_date | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `rtgs_limis_log_pk`: rtgs_txnid asc

## Table `temp_debug_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| log_time | timestamptz | true | explicit | False | False |
| p_tomember | varchar(200) | true | implicit_mysql_default | False | False |
| p_frommember | varchar(200) | true | implicit_mysql_default | False | False |
| devFee | int(11) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc

## Table `temp_lnsw`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | explicit | False | False |
| amount | bigint(11) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `temp_lnsw_reference_uindex`: reference asc

## Table `temp_orgl_transfer20260311`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| frommember | varchar(200) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | False |
| requesttime | datetime | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| sourcetxtime | datetime | false | explicit | False | False |
| memberbank_txtime | datetime | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `temp_transfer_id`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `th_incoming_log`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| txtime | datetime | true | implicit_mysql_default | False | False |
| method | varchar(50) | true | implicit_mysql_default | False | False |
| rawrequest | longtext | true | implicit_mysql_default | False | False |
| service | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- index `th_incoming_log_txtime_index`: txtime asc

## Table `th_transaction`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| txtime | timestamptz | false | explicit | False | False |
| msgid | varchar(50) | true | implicit_mysql_default | False | False |
| credttm | varchar(30) | true | implicit_mysql_default | False | False |
| instrid | varchar(50) | true | implicit_mysql_default | False | False |
| msgdefidr | varchar(30) | true | implicit_mysql_default | False | False |
| endtoendid | varchar(50) | true | implicit_mysql_default | False | False |
| orgnlinstrid | varchar(50) | true | implicit_mysql_default | False | False |
| orgnlendtoendid | varchar(50) | true | implicit_mysql_default | False | False |
| orgnlmsgid | varchar(50) | true | implicit_mysql_default | False | False |
| sttlmamt | decimal(10,0) | true | implicit_mysql_default | False | False |
| ccy | varchar(5) | true | implicit_mysql_default | False | False |
| dsplnm | varchar(55) | true | implicit_mysql_default | False | False |
| clrsysmmbid | varchar(20) | true | implicit_mysql_default | False | False |
| bicfi | varchar(15) | true | implicit_mysql_default | False | False |
| json_request | text | true | implicit_mysql_default | False | False |
| json_response | text | true | implicit_mysql_default | False | False |
| xml_request | text | true | implicit_mysql_default | False | False |
| xml_response | text | true | implicit_mysql_default | False | False |
| direction | varchar(10) | true | implicit_mysql_default | False | False |
| method | varchar(15) | true | implicit_mysql_default | False | False |
| frommember | varchar(15) | true | implicit_mysql_default | False | False |
| fromuser | varchar(100) | true | implicit_mysql_default | False | False |
| fromuserfullname | varchar(50) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(50) | true | implicit_mysql_default | False | False |
| tomember | varchar(15) | true | implicit_mysql_default | False | False |
| toaccount | text | true | implicit_mysql_default | False | False |
| accountname | varchar(100) | true | implicit_mysql_default | False | False |
| reference | varchar(100) | true | implicit_mysql_default | False | False |
| time | varchar(30) | true | implicit_mysql_default | False | False |
| srcamount | decimal(10,2) | true | implicit_mysql_default | False | False |
| srcccy | varchar(5) | true | implicit_mysql_default | False | False |
| dstamount | decimal(10,2) | true | implicit_mysql_default | False | False |
| dstccy | varchar(5) | true | implicit_mysql_default | False | False |
| rate | decimal(10,2) | true | implicit_mysql_default | False | False |
| rateccy | varchar(5) | true | implicit_mysql_default | False | False |
| feeamount | decimal(10,2) | true | implicit_mysql_default | False | False |
| feeccy | varchar(5) | true | implicit_mysql_default | False | False |
| result | varchar(100) | true | implicit_mysql_default | False | False |
| isvoid | int(11) | true | implicit_mysql_default | False | False |
| void_date | datetime | true | implicit_mysql_default | False | False |
| void_by | varchar(100) | true | implicit_mysql_default | False | False |
| originatorid | varchar(50) | true | implicit_mysql_default | False | False |
| recipientid | varchar(50) | true | implicit_mysql_default | False | False |
| merchantid | varchar(100) | true | implicit_mysql_default | False | False |
| merchantname | varchar(100) | true | implicit_mysql_default | False | False |
| settlemetdate | varchar(20) | true | implicit_mysql_default | False | False |
| toacctno | varchar(100) | true | implicit_mysql_default | False | False |
| transactiontype | varchar(5) | true | implicit_mysql_default | False | False |
| mchtp | varchar(10) | true | implicit_mysql_default | False | False |
| txtime_dt | date | true | implicit_mysql_default | False | True |
| lookupCache | longtext | true | implicit_mysql_default | False | False |
| paymentCache | longtext | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `th_transaction_method_instrid_uindex`: method asc, instrid asc
- index `txtime_dt`: txtime_dt asc
- index `th_transaction_method_reference_index`: method asc, reference asc
- index `th_transaction_reference_only_index`: reference asc
- index `th_transaction_instrid_index`: instrid asc
- index `th_transaction_settlemetdate_index`: settlemetdate asc
- index `idx_txn_performance_tuning`: fromaccount asc, merchantid asc, txtime_dt asc, result asc, direction asc, srcamount asc

## Table `th_update_error`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | true | implicit_mysql_default | False | False |
| method | varchar(50) | true | implicit_mysql_default | False | False |
| updatedata | longtext | true | implicit_mysql_default | False | False |
| error | text | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- index `th_update_transaction_reference_index`: reference asc

## Table `transfer`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | primary_key | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| fromuser | varchar(200) | false | explicit | False | False |
| fromaccount | varchar(200) | false | explicit | False | False |
| totype | varchar(200) | false | explicit | False | False |
| toaccount | varchar(5000) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| purpose | varchar(500) | true | implicit_mysql_default | False | False |
| isreconciled | tinyint(1) | false | explicit | False | False |
| issettled | tinyint(1) | false | explicit | False | False |
| settletime | datetime | true | implicit_mysql_default | False | False |
| txtype | varchar(200) | true | implicit_mysql_default | False | False |
| fee | decimal(24,2) | true | implicit_mysql_default | False | False |
| originalreference | varchar(200) | true | implicit_mysql_default | False | False |
| shouldrevert | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | True |
| receipt | varchar(100) | true | implicit_mysql_default | False | False |
| fromchannel | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc, requesttime asc
- unique `idx_unq_transfer`: reference asc, requesttime asc
- index `idx1_transfer`: frommember asc
- index `idx2_transfer`: requesttime asc
- index `idx3_transfer`: responsetime asc
- index `idx4_transfer`: result asc
- index `idx5_transfer`: tomember asc
- index `idx6_transfer`: originalreference asc
- index `idx7_transfer`: txtime asc
- index `idx8_transfer`: totype asc
- index `idx9_transfer`: requesttime_dt asc, tomember asc
- index `idx10`: requesttime_dt asc, result asc, frommember asc, fromuser asc

## Table `transferiso`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(100) | false | explicit | False | False |
| frommember | varchar(100) | false | explicit | False | False |
| tomember | varchar(100) | false | explicit | False | False |
| request | varchar(5000) | true | implicit_mysql_default | False | False |
| response | varchar(5000) | true | implicit_mysql_default | False | False |
| txtime | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `transferiso_reference_frommember_tomember_uindex`: reference asc, frommember asc, tomember asc
- index `transferiso_frommember_index`: frommember asc
- index `transferiso_reference_index`: reference asc
- index `transferiso_tomember_index`: tomember asc
- index `transferiso_txtime_index`: txtime asc

## Table `transfer_hist`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | primary_key | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| fromuser | varchar(200) | false | explicit | False | False |
| fromaccount | varchar(200) | false | explicit | False | False |
| totype | varchar(200) | false | explicit | False | False |
| toaccount | varchar(5000) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| purpose | varchar(500) | true | implicit_mysql_default | False | False |
| isreconciled | tinyint(1) | false | explicit | False | False |
| issettled | tinyint(1) | false | explicit | False | False |
| settletime | datetime | true | implicit_mysql_default | False | False |
| txtype | varchar(200) | true | implicit_mysql_default | False | False |
| fee | decimal(24,2) | true | implicit_mysql_default | False | False |
| originalreference | varchar(200) | true | implicit_mysql_default | False | False |
| shouldrevert | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | True |

Declared keys/indexes:

- primary `PRIMARY`: id asc, requesttime asc
- unique `idx_unq_transfer`: reference asc, requesttime asc
- index `idx1_transfer_hist`: frommember asc
- index `idx2_transfer_hist`: requesttime asc
- index `idx3_transfer_hist`: responsetime asc
- index `idx4_transfer_hist`: result asc
- index `idx5_transfer_hist`: tomember asc
- index `idx6_transfer_hist`: originalreference asc
- index `idx7_transfer_hist`: txtime asc
- index `idx8_transfer_hist`: totype asc
- index `idx9_transfer_hist`: requesttime_dt asc, tomember asc

## Table `transfer_old`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | False | False |
| txtime | datetime | false | explicit | False | False |
| requesttime | datetime | false | explicit | False | False |
| reference | varchar(200) | false | explicit | False | False |
| frommember | varchar(200) | false | explicit | False | False |
| fromuser | varchar(200) | false | explicit | False | False |
| fromaccount | varchar(200) | false | explicit | False | False |
| totype | varchar(200) | false | explicit | False | False |
| toaccount | varchar(5000) | false | explicit | False | False |
| tomember | varchar(200) | false | explicit | False | False |
| responsetime | datetime | true | implicit_mysql_default | False | False |
| result | varchar(200) | true | implicit_mysql_default | False | False |
| amount | decimal(24,2) | false | explicit | False | False |
| ccy | varchar(200) | false | explicit | False | False |
| purpose | varchar(500) | true | implicit_mysql_default | False | False |
| isreconciled | tinyint(1) | false | explicit | False | False |
| issettled | tinyint(1) | false | explicit | False | False |
| settletime | datetime | true | implicit_mysql_default | False | False |
| txtype | varchar(200) | true | implicit_mysql_default | False | False |
| fee | decimal(24,2) | true | implicit_mysql_default | False | False |
| originalreference | varchar(200) | true | implicit_mysql_default | False | False |
| shouldrevert | int(11) | true | implicit_mysql_default | False | False |
| qrtype | varchar(100) | true | implicit_mysql_default | False | False |
| requesttime_dt | date | true | implicit_mysql_default | False | True |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `transfer_reference_pk`: reference asc
- index `transfer_frommember_index`: frommember asc
- index `transfer_requesttime_index`: requesttime asc
- index `transfer_responsetime_index`: responsetime asc
- index `transfer_result_index`: result asc
- index `transfer_tomember_index`: tomember asc
- index `transfer_originalreference_index`: originalreference asc
- index `transfer_txtime_index`: txtime asc
- index `transfer_totype_index`: totype asc
- index `requesttime_dt`: requesttime_dt asc, tomember asc

## Table `transfer_reference`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| reference | varchar(200) | false | primary_key | False | False |

Declared keys/indexes:

- primary `PRIMARY`: reference asc

## Table `upi_block_merchant`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| mcid | varchar(50) | false | primary_key | False | False |
| adddate | datetime | true | implicit_mysql_default | False | False |
| merchantname | varchar(100) | true | implicit_mysql_default | False | False |
| tomember | varchar(10) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: mcid asc
- unique `upi_block_merchant_mcid_uindex`: mcid asc

## Table `upi_chargeback`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | uint(10) | false | primary_key | True | False |
| full_date | date | false | explicit | False | False |
| folder_name | varchar(30) | false | explicit | False | False |
| section | varchar(10) | false | explicit | False | False |
| iin_acq | varchar(10) | false | explicit | False | False |
| iin_iss | varchar(10) | false | explicit | False | False |
| dispute_stlm_date | date | false | explicit | False | False |
| account_number | varchar(25) | true | implicit_mysql_default | False | False |
| orig_trans_s_num | varchar(15) | true | implicit_mysql_default | False | False |
| orig_trans_date | varchar(15) | false | explicit | False | False |
| dispute_amount | decimal(20,6) | false | explicit | False | False |
| exchange_rate | decimal(14,10) | false | explicit | False | False |
| discount_amount | decimal(20,6) | false | explicit | False | False |
| merchant_code | varchar(30) | false | explicit | False | False |
| merchant_name | varchar(50) | true | implicit_mysql_default | False | False |
| dispute_desc | varchar(50) | false | explicit | False | False |
| reason_code | varchar(10) | false | explicit | False | False |
| created_at | datetime | false | explicit | False | False |
| updated_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `idx_full_date`: full_date asc
- index `idx_folder_name`: folder_name asc
- index `idx_iin_acq`: iin_acq asc
- index `idx_iin_iss`: iin_iss asc
- index `idx_account`: account_number asc
- index `idx_reason_code`: reason_code asc

## Table `upi_dispute_transaction`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | uint(10) | false | primary_key | True | False |
| full_date | date | false | explicit | False | False |
| filename | varchar(30) | false | explicit | False | False |
| acquiring_institution_id | char(11) | false | explicit | False | False |
| forwarding_institution_id | char(11) | false | explicit | False | False |
| system_trace_audit_number | char(6) | false | explicit | False | False |
| transmission_date_time | datetime | true | implicit_mysql_default | False | False |
| pan | varchar(19) | false | explicit | False | False |
| transaction_amount | decimal(20,4) | false | explicit | False | False |
| merchant_type | char(4) | false | explicit | False | False |
| terminal_id | varchar(8) | false | explicit | False | False |
| merchant_id | varchar(15) | false | explicit | False | False |
| merchant_name_location | varchar(40) | false | explicit | False | False |
| retrieval_reference_number | char(12) | false | explicit | False | False |
| auth_id_response | char(6) | false | explicit | False | False |
| receiving_institution_id | char(11) | false | explicit | False | False |
| orig_transaction_stan | char(6) | false | explicit | False | False |
| currency_code_transaction | char(3) | false | explicit | False | False |
| currency_code_settlement | char(3) | false | explicit | False | False |
| settlement_amount | decimal(20,4) | false | explicit | False | False |
| conversion_rate_settlement | decimal(20,4) | false | explicit | False | False |
| settlement_date | char(4) | false | explicit | False | False |
| exchange_date | char(4) | false | explicit | False | False |
| fee_receivable | decimal(20,4) | false | explicit | False | False |
| orig_transaction_date_time | char(10) | false | explicit | False | False |
| additional_information | varchar(30) | false | explicit | False | False |
| total_fee_amount | decimal(20,6) | false | explicit | False | False |
| card_product | char(2) | false | explicit | False | False |
| account_attribute | char(2) | false | explicit | False | False |
| union_pay_card_indicator | char(1) | false | explicit | False | False |
| created_at | datetime | false | explicit | False | False |
| updated_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `idx_full_date`: full_date asc
- index `idx_filename`: filename asc
- index `idx_pan`: pan asc
- index `idx_stan`: system_trace_audit_number asc

## Table `upi_enc_certificate_uias`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| OP_ENC_CER_ID | varchar(20) | false | explicit | False | False |
| OP_ENC_CER_DATE | datetime | false | explicit | False | False |
| OP_ENC_CER_KEY_INDEX | int(11) | false | explicit | False | False |
| OP_ENC_CER | longtext | true | implicit_mysql_default | False | False |
| OP_ENC_PRIVATE_KEY | longtext | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `OP_ENC_CER_ID`: OP_ENC_CER_ID asc

## Table `upi_fee_detail`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | uint(10) | false | primary_key | True | False |
| full_date | date | false | explicit | False | False |
| filename | varchar(30) | false | explicit | False | False |
| acquiring_institution_id | varchar(11) | false | explicit | False | False |
| forwarding_institution_id | varchar(11) | false | explicit | False | False |
| system_trace_audit_number | varchar(6) | false | explicit | False | False |
| transmission_date_time | datetime | true | implicit_mysql_default | False | False |
| pan | varchar(19) | false | explicit | False | False |
| card_acceptor_id | varchar(15) | false | explicit | False | False |
| authorization_id | varchar(6) | false | explicit | False | False |
| reversal_id | char(1) | false | explicit | False | False |
| transaction_type_id | char(1) | false | explicit | False | False |
| receiving_institution_id | varchar(11) | false | explicit | False | False |
| issuing_institution_id | varchar(11) | false | explicit | False | False |
| currency_code | varchar(3) | false | explicit | False | False |
| fee_type | char(1) | false | explicit | False | False |
| total_reimbursement_fee_amount | decimal(20,6) | false | explicit | False | False |
| total_service_fee_amount | decimal(20,6) | false | explicit | False | False |
| created_at | datetime | false | explicit | False | False |
| updated_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `idx_full_date`: full_date asc
- index `idx_filename`: filename asc
- index `idx_pan`: pan asc
- index `idx_stan`: system_trace_audit_number asc

## Table `upi_fee_disbursement`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | uint(10) | false | primary_key | True | False |
| full_date | date | false | explicit | False | False |
| filename | varchar(30) | false | explicit | False | False |
| section | varchar(10) | false | explicit | False | False |
| iin_acq | varchar(10) | false | explicit | False | False |
| iin_iss | varchar(10) | false | explicit | False | False |
| dispute_stlm_date | date | false | explicit | False | False |
| amount | decimal(20,6) | false | explicit | False | False |
| detail_desc | varchar(200) | false | explicit | False | False |
| reason_code | varchar(10) | false | explicit | False | False |
| created_at | datetime | false | explicit | False | False |
| updated_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- index `idx_full_date`: full_date asc
- index `idx_filename`: filename asc
- index `idx_iin_acq`: iin_acq asc
- index `idx_iin_iss`: iin_iss asc
- index `idx_reason_code`: reason_code asc

## Table `upi_incomming`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| TXN_ID | bigint(20) | false | primary_key | True | False |
| ID | varchar(50) | true | implicit_mysql_default | False | False |
| ACQ_BIN | varchar(100) | true | implicit_mysql_default | False | False |
| ISS_BIN | varchar(100) | true | implicit_mysql_default | False | False |
| TRACENO | varchar(100) | true | implicit_mysql_default | False | False |
| TRANSMITDATE | datetime | true | implicit_mysql_default | False | False |
| CARD_NO | varchar(100) | true | implicit_mysql_default | False | False |
| TXN_AMT | decimal(15,2) | true | implicit_mysql_default | False | False |
| MSG_TYPE | varchar(100) | true | implicit_mysql_default | False | False |
| PROC_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| MERCHANT_TYPE | varchar(100) | true | implicit_mysql_default | False | False |
| CARD_ACCEPTOR_TERMID | varchar(100) | true | implicit_mysql_default | False | False |
| CARD_ACCEPTOR_ID_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| MERCHANT_NAME | varchar(100) | true | implicit_mysql_default | False | False |
| REFERENCENO | varchar(100) | true | implicit_mysql_default | False | False |
| POS_CON_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| AUTH_ID_RESPONSE | varchar(100) | true | implicit_mysql_default | False | False |
| RECEIVE_INST_ID_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| ORGTXN_SYSTEM_TRACENO | varchar(100) | true | implicit_mysql_default | False | False |
| RESPONSECODE | varchar(50) | true | implicit_mysql_default | False | False |
| TXN_CURRCODE | varchar(100) | true | implicit_mysql_default | False | False |
| POS_ENTRYMODE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLE_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLE_AMT | decimal(15,2) | true | implicit_mysql_default | False | False |
| SETTLE_EXCG_RATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| SETTLE_DATE | datetime | true | implicit_mysql_default | False | False |
| COM_RECEIVED | decimal(15,2) | true | implicit_mysql_default | False | False |
| COM_PAID | decimal(15,2) | true | implicit_mysql_default | False | False |
| INTERCHANGE_SERVICEFEES | varchar(30) | true | implicit_mysql_default | False | False |
| SERVICEFEES_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| SERVICEFEES_EXCG_RATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| TXNFEES | varchar(30) | true | implicit_mysql_default | False | False |
| RF_BILLING_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| RF_EXCGRATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| RESERVE_USE | varchar(100) | true | implicit_mysql_default | False | False |
| FILENAME | varchar(100) | true | implicit_mysql_default | False | False |
| TYPE | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: TXN_ID asc
- unique `unique_transaction`: REFERENCENO asc, TRACENO asc, TRANSMITDATE asc
- unique `uk_transaction`: REFERENCENO asc, TRACENO asc, TRANSMITDATE asc
- index `upi_incomming_REFERENCENO_index`: REFERENCENO asc

## Table `upi_incomming_20251231`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| TXN_ID | bigint(20) | false | explicit | False | False |
| ID | varchar(50) | true | implicit_mysql_default | False | False |
| ACQ_BIN | varchar(100) | true | implicit_mysql_default | False | False |
| ISS_BIN | varchar(100) | true | implicit_mysql_default | False | False |
| TRACENO | varchar(100) | true | implicit_mysql_default | False | False |
| TRANSMITDATE | datetime | true | implicit_mysql_default | False | False |
| CARD_NO | varchar(100) | true | implicit_mysql_default | False | False |
| TXN_AMT | decimal(15,2) | true | implicit_mysql_default | False | False |
| MSG_TYPE | varchar(100) | true | implicit_mysql_default | False | False |
| PROC_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| MERCHANT_TYPE | varchar(100) | true | implicit_mysql_default | False | False |
| CARD_ACCEPTOR_TERMID | varchar(100) | true | implicit_mysql_default | False | False |
| CARD_ACCEPTOR_ID_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| MERCHANT_NAME | varchar(100) | true | implicit_mysql_default | False | False |
| REFERENCENO | varchar(100) | true | implicit_mysql_default | False | False |
| POS_CON_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| AUTH_ID_RESPONSE | varchar(100) | true | implicit_mysql_default | False | False |
| RECEIVE_INST_ID_CODE | varchar(100) | true | implicit_mysql_default | False | False |
| ORGTXN_SYSTEM_TRACENO | varchar(100) | true | implicit_mysql_default | False | False |
| RESPONSECODE | varchar(50) | true | implicit_mysql_default | False | False |
| TXN_CURRCODE | varchar(100) | true | implicit_mysql_default | False | False |
| POS_ENTRYMODE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLE_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLE_AMT | decimal(15,2) | true | implicit_mysql_default | False | False |
| SETTLE_EXCG_RATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| SETTLE_DATE | datetime | true | implicit_mysql_default | False | False |
| COM_RECEIVED | decimal(15,2) | true | implicit_mysql_default | False | False |
| COM_PAID | decimal(15,2) | true | implicit_mysql_default | False | False |
| INTERCHANGE_SERVICEFEES | varchar(30) | true | implicit_mysql_default | False | False |
| SERVICEFEES_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| SERVICEFEES_EXCG_RATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| TXNFEES | varchar(30) | true | implicit_mysql_default | False | False |
| RF_BILLING_CURCODE | varchar(100) | true | implicit_mysql_default | False | False |
| RF_EXCGRATE | decimal(15,8) | true | implicit_mysql_default | False | False |
| RESERVE_USE | varchar(100) | true | implicit_mysql_default | False | False |
| FILENAME | varchar(100) | true | implicit_mysql_default | False | False |
| TYPE | varchar(50) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- None declared in this CREATE TABLE.

## Table `upi_message`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| VERSIONNO | varchar(5) | false | explicit | False | False |
| MSGID | varchar(29) | false | explicit | False | False |
| TIMESTAMP | varchar(20) | false | explicit | False | False |
| MSGTYPE | varchar(50) | false | explicit | False | False |
| ACQUIRERIIN | varchar(8) | false | explicit | False | False |
| QRCVOUCHERNO | varchar(20) | false | explicit | False | False |
| MPQRCPAYLOAD | varchar(512) | false | explicit | False | False |
| CAPTUREMETHOD | varchar(64) | false | explicit | False | False |
| PAN | varchar(2048) | false | explicit | False | False |
| TRXAMT | decimal(15,3) | false | explicit | False | False |
| TRXCURRENCY | varchar(3) | false | explicit | False | False |
| DISCOUNTDETAILS | varchar(2048) | true | implicit_mysql_default | False | False |
| QRCUSECASE | varchar(2) | true | implicit_mysql_default | False | False |
| ADDITIONALDATA | varchar(2048) | true | implicit_mysql_default | False | False |
| TERMINALID | varchar(8) | true | implicit_mysql_default | False | False |
| RESPONSECODE | varchar(2) | true | implicit_mysql_default | False | False |
| RESPONSEMSG | varchar(100) | true | implicit_mysql_default | False | False |
| UAISSIGNCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| ACQUIRERSIGNCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| ACQUIRERENCCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| SIGNATURE | varchar(2048) | true | implicit_mysql_default | False | False |
| XCQTIME | timestamptz(6) | true | explicit | False | False |
| RAWMSG | longtext | true | implicit_mysql_default | False | False |
| DECRYPTPAN | varchar(20) | true | implicit_mysql_default | False | False |
| TID | varchar(100) | true | implicit_mysql_default | False | False |
| IID | varchar(100) | true | implicit_mysql_default | False | False |
| UUID | varchar(100) | true | implicit_mysql_default | False | False |
| LMPSRAWJSON | longtext | true | implicit_mysql_default | False | False |
| JSON_REQUEST | longtext | true | implicit_mysql_default | False | False |
| JSON_RESPONSE | longtext | true | implicit_mysql_default | False | False |
| TOMEMBER | varchar(50) | true | implicit_mysql_default | False | False |
| TOMERCHANT | varchar(50) | true | implicit_mysql_default | False | False |
| MERCHANTID | varchar(50) | true | implicit_mysql_default | False | False |
| MERCHANTNAME | varchar(50) | true | implicit_mysql_default | False | False |
| UPI_REQUEST | longtext | true | implicit_mysql_default | False | False |
| UPI_RESPONSE | longtext | true | implicit_mysql_default | False | False |
| LAKAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |
| FEEAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `upi_message_MSGID_uindex`: MSGID asc

## Table `upi_message_old`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| VERSIONNO | varchar(5) | false | explicit | False | False |
| MSGID | varchar(29) | false | primary_key | False | False |
| TIMESTAMP | varchar(20) | false | explicit | False | False |
| MSGTYPE | varchar(50) | false | explicit | False | False |
| ACQUIRERIIN | varchar(8) | false | explicit | False | False |
| QRCVOUCHERNO | varchar(20) | false | explicit | False | False |
| MPQRCPAYLOAD | varchar(512) | false | explicit | False | False |
| CAPTUREMETHOD | varchar(64) | false | explicit | False | False |
| PAN | varchar(2048) | false | explicit | False | False |
| TRXAMT | decimal(10,0) | false | explicit | False | False |
| TRXCURRENCY | varchar(3) | false | explicit | False | False |
| DISCOUNTDETAILS | varchar(2048) | true | implicit_mysql_default | False | False |
| QRCUSECASE | varchar(2) | true | implicit_mysql_default | False | False |
| ADDITIONALDATA | varchar(2048) | true | implicit_mysql_default | False | False |
| TERMINALID | varchar(8) | true | implicit_mysql_default | False | False |
| RESPONSECODE | varchar(2) | true | implicit_mysql_default | False | False |
| RESPONSEMSG | varchar(100) | true | implicit_mysql_default | False | False |
| UAISSIGNCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| ACQUIRERSIGNCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| ACQUIRERENCCERTID | varchar(128) | true | implicit_mysql_default | False | False |
| SIGNATURE | varchar(2048) | true | implicit_mysql_default | False | False |
| XCQTIME | timestamptz(6) | true | explicit | False | False |
| RAWMSG | longtext | true | implicit_mysql_default | False | False |
| DECRYPTPAN | varchar(20) | true | implicit_mysql_default | False | False |
| TID | varchar(100) | true | implicit_mysql_default | False | False |
| IID | varchar(100) | true | implicit_mysql_default | False | False |
| UUID | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: MSGID asc

## Table `upi_rate_history`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| rec | int(11) | false | primary_key | True | False |
| txtime | timestamptz | true | explicit | False | False |
| basecurrency | varchar(5) | true | implicit_mysql_default | False | False |
| transactioncurrency | varchar(5) | true | implicit_mysql_default | False | False |
| rate | float | true | implicit_mysql_default | False | False |
| ratedate | varchar(8) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: rec asc

## Table `upi_settlement_summary`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | uint(10) | false | primary_key | True | False |
| full_date | date | false | explicit | False | False |
| folder_name | varchar(30) | false | explicit | False | False |
| settlement_count | uint(10) | false | explicit | False | False |
| transaction_amount | decimal(20,2) | false | explicit | False | False |
| settlement_amount | decimal(20,6) | false | explicit | False | False |
| reimbursement_fee | decimal(20,6) | false | explicit | False | False |
| service_fee | decimal(20,6) | false | explicit | False | False |
| net_settlement_amount | decimal(20,6) | false | explicit | False | False |
| nd_count | uint(10) | false | explicit | False | False |
| nd_transaction_amount | decimal(20,2) | false | explicit | False | False |
| nd_settlement_amount | decimal(20,6) | false | explicit | False | False |
| nd_reimbursement_fee | decimal(20,6) | false | explicit | False | False |
| nd_service_fee | decimal(20,6) | false | explicit | False | False |
| nd_net_settlement_amount | decimal(20,6) | false | explicit | False | False |
| dp_count | uint(10) | false | explicit | False | False |
| dp_transaction_amount | decimal(20,2) | false | explicit | False | False |
| dp_settlement_amount | decimal(20,6) | false | explicit | False | False |
| dp_reimbursement_fee | decimal(20,6) | false | explicit | False | False |
| dp_service_fee | decimal(20,6) | false | explicit | False | False |
| dp_net_settlement_amount | decimal(20,6) | false | explicit | False | False |
| created_at | datetime | false | explicit | False | False |
| updated_at | datetime | false | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uq_folder`: folder_name asc
- index `idx_full_date`: full_date asc

## Table `upi_sing_certificate_uias`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| OP_SIGN_CER_ID | varchar(50) | false | explicit | False | False |
| OP_SIGN_CER_DATE | timestamptz | false | explicit | False | False |
| OP_SIGN_CER_KEY_INDEX | int(11) | false | explicit | False | False |
| OP_SIGN_CER | longtext | true | implicit_mysql_default | False | False |
| OP_SIGN_PRIVATE_KEY | longtext | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `OP_SIGN_CER_ID`: OP_SIGN_CER_ID asc

## Table `upi_trx_status_notification`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| TXTIME | date | true | implicit_mysql_default | False | False |
| PAN | varchar(2048) | true | implicit_mysql_default | False | False |
| ORIGINALMSGID | varchar(29) | true | implicit_mysql_default | False | False |
| TRXAMT | decimal(15,3) | true | implicit_mysql_default | False | False |
| TRXCURRENCY | varchar(3) | true | implicit_mysql_default | False | False |
| QRCVOUCHERNO | varchar(20) | true | implicit_mysql_default | False | False |
| DISCOUNTDETAILS | longtext | true | implicit_mysql_default | False | False |
| ORIGINALAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |
| COSTAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |
| TRXRESPONSECODE | varchar(20) | true | implicit_mysql_default | False | False |
| TRXRESPONSEMESSAGE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLEMENTDATE | varchar(4) | true | implicit_mysql_default | False | False |
| SETTLEMENTCURRENCY | varchar(3) | true | implicit_mysql_default | False | False |
| SETTLEMENTAMT | decimal(15,3) | true | implicit_mysql_default | False | False |
| SETTLEMENTCONVRATE | decimal(15,3) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGCURRENCY | varchar(3) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGAMT | decimal(15,3) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGCONVRATE | decimal(15,3) | true | implicit_mysql_default | False | False |
| CONVERSIONDATE | varchar(4) | true | implicit_mysql_default | False | False |
| MERCHANTID | varchar(50) | true | implicit_mysql_default | False | False |
| MCC | varchar(4) | true | implicit_mysql_default | False | False |
| MERCHANTCOUNTRY | varchar(3) | true | implicit_mysql_default | False | False |
| MERCHANTNAME | varchar(50) | true | implicit_mysql_default | False | False |
| MERCHANTCITY | varchar(15) | true | implicit_mysql_default | False | False |
| RETRIEVALREFERENCENUMBER | varchar(50) | true | implicit_mysql_default | False | False |
| TERMINALID | varchar(8) | true | implicit_mysql_default | False | False |
| RAWMSG | longtext | true | implicit_mysql_default | False | False |
| ISREFUNDED | decimal(15,3) | true | implicit_mysql_default | False | False |
| REFUNDDATE | date | true | implicit_mysql_default | False | False |
| REFUNDTYPE | varchar(20) | true | implicit_mysql_default | False | False |
| REFRESPONSECODE | varchar(5) | true | implicit_mysql_default | False | False |
| REFRESPONSEMSG | varchar(100) | true | implicit_mysql_default | False | False |
| DECRYPTPAN | varchar(20) | true | implicit_mysql_default | False | False |
| MSGID | varchar(29) | false | primary_key | False | False |
| ISSETTLED | decimal(15,3) | true | implicit_mysql_default | False | False |
| SETTLEREFNO | varchar(30) | true | implicit_mysql_default | False | False |
| XCQTIME | timestamptz | true | explicit | False | False |
| TOMERCHANT | varchar(50) | true | implicit_mysql_default | False | False |
| JSON_REQUEST | longtext | true | implicit_mysql_default | False | False |
| JSON_RESPONSE | longtext | true | implicit_mysql_default | False | False |
| TOMEMBER | varchar(50) | true | implicit_mysql_default | False | False |
| UPI_REQUEST | longtext | true | implicit_mysql_default | False | False |
| UPI_RESPONSE | longtext | true | implicit_mysql_default | False | False |
| LAKAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |
| FEEAMOUNT | decimal(15,3) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: MSGID asc
- unique `upi_trx_status_notification_MSGID_uindex`: MSGID asc
- index `upi_trx_status_notification_ORIGINALMSGID_index`: ORIGINALMSGID asc
- index `idx_trx_merchant`: TXTIME asc, MERCHANTID asc
- index `idx_refund_status`: ISREFUNDED asc, REFUNDDATE asc
- index `idx_settlement`: ISSETTLED asc, SETTLEMENTDATE asc
- index `upi_trx_status_notification_XCQTIME_index`: XCQTIME asc
- index `upi_trx_status_notification_RETRIEVALREFERENCENUMBER_index`: RETRIEVALREFERENCENUMBER asc
- index `idx_upi_risk_monitor`: TXTIME asc, TRXRESPONSECODE asc, MERCHANTID asc, ORIGINALMSGID asc

## Table `upi_trx_status_notification_old`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| TXTIME | date | true | implicit_mysql_default | False | False |
| PAN | varchar(2048) | true | implicit_mysql_default | False | False |
| ORIGINALMSGID | varchar(29) | false | primary_key | False | False |
| TRXAMT | decimal(10,0) | true | implicit_mysql_default | False | False |
| TRXCURRENCY | decimal(10,0) | true | implicit_mysql_default | False | False |
| QRCVOUCHERNO | varchar(20) | true | implicit_mysql_default | False | False |
| DISCOUNTDETAILS | longtext | true | implicit_mysql_default | False | False |
| ORIGINALAMOUNT | decimal(10,0) | true | implicit_mysql_default | False | False |
| COSTAMOUNT | decimal(10,0) | true | implicit_mysql_default | False | False |
| TRXRESPONSECODE | varchar(20) | true | implicit_mysql_default | False | False |
| TRXRESPONSEMESSAGE | varchar(100) | true | implicit_mysql_default | False | False |
| SETTLEMENTDATE | varchar(4) | true | implicit_mysql_default | False | False |
| SETTLEMENTCURRENCY | varchar(3) | true | implicit_mysql_default | False | False |
| SETTLEMENTAMT | decimal(10,0) | true | implicit_mysql_default | False | False |
| SETTLEMENTCONVRATE | decimal(10,0) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGCURRENCY | varchar(3) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGAMT | decimal(10,0) | true | implicit_mysql_default | False | False |
| CARDHOLDERBILLINGCONVRATE | decimal(10,0) | true | implicit_mysql_default | False | False |
| CONVERSIONDATE | varchar(4) | true | implicit_mysql_default | False | False |
| MERCHANTID | varchar(15) | true | implicit_mysql_default | False | False |
| MCC | varchar(4) | true | implicit_mysql_default | False | False |
| MERCHANTCOUNTRY | varchar(3) | true | implicit_mysql_default | False | False |
| MERCHANTNAME | varchar(25) | true | implicit_mysql_default | False | False |
| MERCHANTCITY | varchar(15) | true | implicit_mysql_default | False | False |
| RETRIEVALREFERENCENUMBER | varchar(12) | true | implicit_mysql_default | False | False |
| TERMINALID | varchar(8) | true | implicit_mysql_default | False | False |
| RAWMSG | longtext | true | implicit_mysql_default | False | False |
| ISREFUNDED | decimal(10,0) | true | implicit_mysql_default | False | False |
| REFUNDDATE | date | true | implicit_mysql_default | False | False |
| REFUNDTYPE | varchar(20) | true | implicit_mysql_default | False | False |
| REFRESPONSECODE | varchar(5) | true | implicit_mysql_default | False | False |
| REFRESPONSEMSG | varchar(100) | true | implicit_mysql_default | False | False |
| DECRYPTPAN | varchar(20) | true | implicit_mysql_default | False | False |
| MSGID | varchar(29) | true | implicit_mysql_default | False | False |
| ISSETTLED | decimal(10,0) | true | implicit_mysql_default | False | False |
| SETTLEREFNO | varchar(30) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: ORIGINALMSGID asc
- unique `UPI_TRX_STATUS_MSGID`: MSGID asc
- unique `UPI_TRX_STATUS_ORIGINALMSGID`: ORIGINALMSGID asc

## Table `upi_uias_certificate`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| UIAS_CER_ID | varchar(20) | false | primary_key | False | False |
| UIAS_CER_DATE | date | false | explicit | False | False |
| UIAS_CER_TYPE | varchar(20) | false | explicit | False | False |
| UIAS_KEY_INDEX | varchar(20) | false | explicit | False | False |
| UIAS_CERTIFICATE | longtext | true | implicit_mysql_default | False | False |
| LAST_KEY_INDEX | decimal(10,0) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: UIAS_CER_ID asc

## Table `users`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| userid | varchar(50) | false | primary_key | False | False |
| passwd | varchar(150) | true | implicit_mysql_default | False | False |
| fullname | varchar(150) | true | implicit_mysql_default | False | False |
| contact | varchar(50) | true | implicit_mysql_default | False | False |
| agentid | varchar(50) | false | explicit | False | False |
| roleid | varchar(20) | true | implicit_mysql_default | False | False |
| userstatus | varchar(10) | false | explicit | False | False |
| remarks | varchar(250) | true | implicit_mysql_default | False | False |
| registerdate | timestamptz | false | explicit | False | False |
| usertype | varchar(100) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: userid asc
- unique `users_userid_uindex`: userid asc

## Table `user_role`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| urid | int(11) | false | primary_key | True | False |
| userid | varchar(50) | true | implicit_mysql_default | False | False |
| servicetype | varchar(100) | true | implicit_mysql_default | False | False |
| txtime | datetime | true | implicit_mysql_default | False | False |
| roleid | varchar(50) | true | implicit_mysql_default | False | False |
| userstatus | varchar(30) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: urid asc

## Table `vn_disputedetails`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| msg_type | varchar(10) | true | implicit_mysql_default | False | False |
| pan | varchar(25) | true | implicit_mysql_default | False | False |
| proc_code | varchar(10) | false | explicit | False | False |
| svc_code | varchar(10) | true | implicit_mysql_default | False | False |
| channel_code | varchar(5) | true | implicit_mysql_default | False | False |
| txn_amt | decimal(15,2) | false | explicit | False | False |
| real_txn_amt | decimal(15,2) | true | implicit_mysql_default | False | False |
| txn_ccy | char(3) | true | implicit_mysql_default | False | False |
| settle_amt | decimal(15,2) | true | implicit_mysql_default | False | False |
| settle_ccy | char(3) | true | implicit_mysql_default | False | False |
| settle_rate | decimal(12,6) | true | implicit_mysql_default | False | False |
| billing_amt | decimal(15,2) | true | implicit_mysql_default | False | False |
| real_billing_amt | decimal(15,2) | true | implicit_mysql_default | False | False |
| billing_ccy | char(3) | true | implicit_mysql_default | False | False |
| billing_rate | decimal(12,6) | true | implicit_mysql_default | False | False |
| trace_no | varchar(10) | true | implicit_mysql_default | False | False |
| txn_time | varchar(10) | true | implicit_mysql_default | False | False |
| txn_date | varchar(10) | false | explicit | False | False |
| settle_date | varchar(10) | true | implicit_mysql_default | False | False |
| settlementdate | date | true | implicit_mysql_default | False | False |
| mcc | varchar(10) | true | implicit_mysql_default | False | False |
| pos_entry_mode | varchar(5) | true | implicit_mysql_default | False | False |
| pos_cond_code | varchar(5) | true | implicit_mysql_default | False | False |
| terminal_id | varchar(20) | true | implicit_mysql_default | False | False |
| acq_code | varchar(10) | true | implicit_mysql_default | False | False |
| iss_code | varchar(10) | true | implicit_mysql_default | False | False |
| merchant_id | varchar(20) | true | implicit_mysql_default | False | False |
| bnb_code | varchar(10) | true | implicit_mysql_default | False | False |
| src_account | varchar(30) | true | implicit_mysql_default | False | False |
| dst_account | varchar(30) | true | implicit_mysql_default | False | False |
| svf_iss_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_iss_acq | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_iss_bnb | decimal(15,2) | true | implicit_mysql_default | False | False |
| svf_acq_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_acq_iss | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_acq_bnb | decimal(15,2) | true | implicit_mysql_default | False | False |
| svf_bnb_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_bnb_iss | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_bnb_acq | decimal(15,2) | true | implicit_mysql_default | False | False |
| rrn | varchar(20) | true | implicit_mysql_default | False | False |
| auth_code | varchar(10) | true | implicit_mysql_default | False | False |
| txn_ref | varchar(20) | false | explicit | False | False |
| recon_code | varchar(10) | true | implicit_mysql_default | False | False |
| rsv1 | varchar(100) | true | implicit_mysql_default | False | False |
| rsv2 | varchar(100) | true | implicit_mysql_default | False | False |
| rsv3 | varchar(100) | true | implicit_mysql_default | False | False |
| checksum | varchar(35) | true | implicit_mysql_default | False | False |
| src_file | varchar(100) | false | explicit | False | False |
| inserted_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uk_txn_dedup`: txn_ref asc, txn_date asc, proc_code asc
- index `vn_sl_dt_q_idx`: rrn asc, recon_code asc, src_file asc, settlementdate asc

## Table `vn_dispute_import`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| file_date | date | false | explicit | False | False |
| source_file | varchar(100) | false | explicit | False | False |
| records_read | int(11) | false | explicit | False | False |
| records_inserted | int(11) | false | explicit | False | False |
| records_skipped | int(11) | false | explicit | False | False |
| records_rejected | int(11) | false | explicit | False | False |
| imported_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uk_source_file`: source_file asc

## Table `vn_outbound_reconcile_tc`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| MTI | varchar(10) | true | implicit_mysql_default | False | False |
| F2 | varchar(20) | true | implicit_mysql_default | False | False |
| F3 | varchar(10) | true | implicit_mysql_default | False | False |
| SVC | varchar(10) | true | implicit_mysql_default | False | False |
| TCC | varchar(10) | true | implicit_mysql_default | False | False |
| F4 | decimal(10,0) | true | implicit_mysql_default | False | False |
| RTA | decimal(10,0) | true | implicit_mysql_default | False | False |
| F49 | varchar(10) | true | implicit_mysql_default | False | False |
| F5 | varchar(20) | true | implicit_mysql_default | False | False |
| F50 | varchar(10) | true | implicit_mysql_default | False | False |
| F9 | varchar(20) | true | implicit_mysql_default | False | False |
| F6 | decimal(10,0) | true | implicit_mysql_default | False | False |
| RCA | decimal(10,0) | true | implicit_mysql_default | False | False |
| F51 | varchar(10) | true | implicit_mysql_default | False | False |
| F10 | varchar(20) | true | implicit_mysql_default | False | False |
| F11 | varchar(20) | true | implicit_mysql_default | False | False |
| F12 | varchar(20) | true | implicit_mysql_default | False | False |
| F13 | varchar(20) | true | implicit_mysql_default | False | False |
| F15 | varchar(20) | true | implicit_mysql_default | False | False |
| F18 | varchar(20) | true | implicit_mysql_default | False | False |
| F22 | varchar(10) | true | implicit_mysql_default | False | False |
| F25 | varchar(10) | true | implicit_mysql_default | False | False |
| F41 | varchar(20) | true | implicit_mysql_default | False | False |
| ACQ | varchar(20) | true | implicit_mysql_default | False | False |
| ISS | varchar(20) | true | implicit_mysql_default | False | False |
| MID | varchar(20) | true | implicit_mysql_default | False | False |
| BNB | varchar(20) | true | implicit_mysql_default | False | False |
| F102 | varchar(30) | true | implicit_mysql_default | False | False |
| F103 | varchar(30) | true | implicit_mysql_default | False | False |
| SVFISSNP | varchar(30) | true | implicit_mysql_default | False | False |
| IRFISSACQ | varchar(30) | true | implicit_mysql_default | False | False |
| IRFISSBNB | varchar(30) | true | implicit_mysql_default | False | False |
| SVFACQNP | varchar(30) | true | implicit_mysql_default | False | False |
| IRFACQISS | varchar(30) | true | implicit_mysql_default | False | False |
| IRFACQBNB | varchar(30) | true | implicit_mysql_default | False | False |
| SVFBNBNP | varchar(30) | true | implicit_mysql_default | False | False |
| IRFBNBISS | varchar(30) | true | implicit_mysql_default | False | False |
| IRFBNBACQ | varchar(30) | true | implicit_mysql_default | False | False |
| F37 | varchar(30) | true | implicit_mysql_default | False | False |
| F38 | varchar(30) | true | implicit_mysql_default | False | False |
| TRN | varchar(30) | true | implicit_mysql_default | False | False |
| RRC | varchar(30) | true | implicit_mysql_default | False | False |
| RSV1 | varchar(30) | true | implicit_mysql_default | False | False |
| RSV2 | varchar(30) | true | implicit_mysql_default | False | False |
| RSV3 | varchar(30) | true | implicit_mysql_default | False | False |
| CSR | varchar(35) | true | implicit_mysql_default | False | False |
| FILENAME | varchar(100) | true | implicit_mysql_default | False | False |
| IMPORTDATE | timestamptz | true | explicit | False | False |
| FILETYPE | varchar(5) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `vn_outbound_reconcile_TRN_uindex`: TRN asc
- index `idx_recon_f37`: F37 asc

## Table `vn_outbound_reconcile_xl`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| MTI | varchar(10) | true | implicit_mysql_default | False | False |
| F2 | varchar(20) | true | implicit_mysql_default | False | False |
| F3 | varchar(10) | true | implicit_mysql_default | False | False |
| SVC | varchar(10) | true | implicit_mysql_default | False | False |
| TCC | varchar(10) | true | implicit_mysql_default | False | False |
| F4 | decimal(10,0) | true | implicit_mysql_default | False | False |
| RTA | decimal(10,0) | true | implicit_mysql_default | False | False |
| F49 | decimal(10,0) | true | implicit_mysql_default | False | False |
| F5 | varchar(20) | true | implicit_mysql_default | False | False |
| F50 | varchar(10) | true | implicit_mysql_default | False | False |
| F9 | varchar(10) | true | implicit_mysql_default | False | False |
| F6 | varchar(20) | true | implicit_mysql_default | False | False |
| RCA | varchar(20) | true | implicit_mysql_default | False | False |
| F51 | varchar(10) | true | implicit_mysql_default | False | False |
| F10 | varchar(10) | true | implicit_mysql_default | False | False |
| F11 | varchar(10) | true | implicit_mysql_default | False | False |
| F12 | varchar(10) | true | implicit_mysql_default | False | False |
| F13 | varchar(10) | true | implicit_mysql_default | False | False |
| F15 | varchar(10) | true | implicit_mysql_default | False | False |
| F18 | varchar(10) | true | implicit_mysql_default | False | False |
| F22 | varchar(10) | true | implicit_mysql_default | False | False |
| F25 | varchar(10) | true | implicit_mysql_default | False | False |
| F41 | varchar(20) | true | implicit_mysql_default | False | False |
| ACQ | varchar(10) | true | implicit_mysql_default | False | False |
| ISS | varchar(10) | true | implicit_mysql_default | False | False |
| MID | varchar(20) | true | implicit_mysql_default | False | False |
| BNB | varchar(10) | true | implicit_mysql_default | False | False |
| F102 | varchar(30) | true | implicit_mysql_default | False | False |
| F103 | varchar(30) | true | implicit_mysql_default | False | False |
| F37 | varchar(20) | true | implicit_mysql_default | False | False |
| F38 | varchar(10) | true | implicit_mysql_default | False | False |
| TRN | varchar(20) | true | implicit_mysql_default | False | False |
| RRC | varchar(10) | true | implicit_mysql_default | False | False |
| RSV1 | varchar(100) | true | implicit_mysql_default | False | False |
| RSV2 | varchar(100) | true | implicit_mysql_default | False | False |
| RSV3 | varchar(100) | true | implicit_mysql_default | False | False |
| CSR | varchar(35) | true | implicit_mysql_default | False | False |
| FILENAME | varchar(100) | true | implicit_mysql_default | False | False |
| IMPORTDATE | timestamptz | true | explicit | False | False |
| FILETYPE | varchar(5) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `vn_outbound_reconcile_TRN_uindex`: TRN asc
- unique `vn_outbound_reconcile_xl_CSR_FILENAME_uindex`: CSR asc, FILENAME asc

## Table `vn_transaction`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | false | primary_key | True | False |
| txtime | timestamptz | false | explicit | False | False |
| direction | varchar(10) | true | implicit_mysql_default | False | False |
| operation | varchar(15) | true | implicit_mysql_default | False | False |
| channel | varchar(15) | true | implicit_mysql_default | False | False |
| referenceid | varchar(50) | true | implicit_mysql_default | False | False |
| timestamp | varchar(30) | true | implicit_mysql_default | False | False |
| requestorname | varchar(50) | true | implicit_mysql_default | False | False |
| lmps_request | text | true | implicit_mysql_default | False | False |
| lmps_response | text | true | implicit_mysql_default | False | False |
| napas_request | text | true | implicit_mysql_default | False | False |
| napas_response | text | true | implicit_mysql_default | False | False |
| frommember | varchar(15) | true | implicit_mysql_default | False | False |
| fromuser | varchar(100) | true | implicit_mysql_default | False | False |
| fromuserfullname | varchar(100) | true | implicit_mysql_default | False | False |
| fromaccount | varchar(50) | true | implicit_mysql_default | False | False |
| tomember | varchar(15) | true | implicit_mysql_default | False | False |
| toaccount | text | true | implicit_mysql_default | False | False |
| accountname | varchar(100) | true | implicit_mysql_default | False | False |
| reference | varchar(100) | true | implicit_mysql_default | False | False |
| time | varchar(30) | true | implicit_mysql_default | False | False |
| srcamount | decimal(20,2) | true | implicit_mysql_default | False | False |
| srcccy | varchar(5) | true | implicit_mysql_default | False | False |
| dstamount | decimal(20,2) | true | implicit_mysql_default | False | False |
| dstccy | varchar(5) | true | implicit_mysql_default | False | False |
| rate | decimal(10,2) | true | implicit_mysql_default | False | False |
| rateccy | varchar(5) | true | implicit_mysql_default | False | False |
| feeamount | decimal(10,2) | true | implicit_mysql_default | False | False |
| feeccy | varchar(5) | true | implicit_mysql_default | False | False |
| result | varchar(100) | true | implicit_mysql_default | False | False |
| resultcode | varchar(20) | true | implicit_mysql_default | False | False |
| isvoid | int(11) | true | implicit_mysql_default | False | False |
| void_date | datetime | true | implicit_mysql_default | False | False |
| void_by | varchar(100) | true | implicit_mysql_default | False | False |
| opdate | date | true | implicit_mysql_default | False | False |
| settlementdate | date | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `vn_transaction_referenceid_operation_uindex`: referenceid asc, operation asc
- index `vn_transaction_referenceid_index`: referenceid asc
- index `vn_transaction_txtime_index`: txtime asc

## Table `vn_vietnam_bank`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | int(11) | true | implicit_mysql_default | False | False |
| bankname | varchar(200) | true | implicit_mysql_default | False | False |
| code | varchar(20) | true | implicit_mysql_default | False | False |
| bankid | varchar(20) | true | implicit_mysql_default | False | False |

Declared keys/indexes:

- unique `vn_vietnam_bank_bankid_uindex`: bankid asc

## Table `vn_xl_details`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| msg_type | varchar(4) | true | implicit_mysql_default | False | False |
| pan | varchar(19) | true | implicit_mysql_default | False | False |
| proc_code | varchar(6) | false | explicit | False | False |
| svc_code | varchar(10) | true | implicit_mysql_default | False | False |
| channel_code | varchar(2) | true | implicit_mysql_default | False | False |
| txn_amount | decimal(15,2) | false | explicit | False | False |
| real_txn_amount | decimal(15,2) | true | implicit_mysql_default | False | False |
| txn_ccy | char(3) | true | implicit_mysql_default | False | False |
| settle_amount | decimal(15,2) | true | implicit_mysql_default | False | False |
| settle_ccy | char(3) | true | implicit_mysql_default | False | False |
| settle_rate | decimal(12,6) | true | implicit_mysql_default | False | False |
| billing_amount | decimal(15,2) | true | implicit_mysql_default | False | False |
| real_billing_amt | decimal(15,2) | true | implicit_mysql_default | False | False |
| billing_ccy | char(3) | true | implicit_mysql_default | False | False |
| billing_rate | decimal(12,6) | true | implicit_mysql_default | False | False |
| trace_no | varchar(6) | false | explicit | False | False |
| txn_time | varchar(6) | true | implicit_mysql_default | False | False |
| txn_date | varchar(4) | false | explicit | False | False |
| settle_date | varchar(4) | true | implicit_mysql_default | False | False |
| settle_date_full | date | true | implicit_mysql_default | False | False |
| mcc | varchar(4) | true | implicit_mysql_default | False | False |
| pos_entry_mode | varchar(3) | true | implicit_mysql_default | False | False |
| pos_cond_code | varchar(2) | true | implicit_mysql_default | False | False |
| terminal_id | varchar(8) | true | implicit_mysql_default | False | False |
| acq_inst_code | varchar(8) | true | implicit_mysql_default | False | False |
| iss_inst_code | varchar(8) | true | implicit_mysql_default | False | False |
| merchant_id | varchar(15) | true | implicit_mysql_default | False | False |
| bnb_inst_code | varchar(8) | true | implicit_mysql_default | False | False |
| src_account | varchar(28) | true | implicit_mysql_default | False | False |
| dst_account | varchar(28) | true | implicit_mysql_default | False | False |
| svf_iss_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_iss_acq | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_iss_bnb | decimal(15,2) | true | implicit_mysql_default | False | False |
| svf_acq_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_acq_iss | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_acq_bnb | decimal(15,2) | true | implicit_mysql_default | False | False |
| svf_bnb_np | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_bnb_iss | decimal(15,2) | true | implicit_mysql_default | False | False |
| irf_bnb_acq | decimal(15,2) | true | implicit_mysql_default | False | False |
| rrn | varchar(12) | true | implicit_mysql_default | False | False |
| auth_id_resp | varchar(6) | true | implicit_mysql_default | False | False |
| txn_ref | varchar(16) | true | implicit_mysql_default | False | False |
| recon_resp_code | varchar(4) | true | implicit_mysql_default | False | False |
| rsv1 | varchar(100) | true | implicit_mysql_default | False | False |
| rsv2 | varchar(100) | true | implicit_mysql_default | False | False |
| rsv3 | varchar(100) | true | implicit_mysql_default | False | False |
| checksum | varchar(32) | true | implicit_mysql_default | False | False |
| bnb_settle_id | varchar(8) | false | explicit | False | False |
| settle_direction | char(1) | false | explicit | False | False |
| dispute_amount | decimal(15,2) | false | explicit | False | False |
| dispute_currency | char(3) | false | explicit | False | False |
| src_file | varchar(100) | false | explicit | False | False |
| inserted_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uk_xl_dedup`: trace_no asc, txn_date asc, proc_code asc
- index `vn_xl_dt_src_file_index`: src_file asc
- index `vn_xl_dt_stqr_idx`: rrn asc, recon_resp_code asc, bnb_settle_id asc, settle_direction asc
- index `vn_xl_dt_settle_date_full_index`: settle_date_full asc

## Table `vn_xl_importlog`

| Column | Normalized type | Nullable | Basis | Auto increment | Generated |
| --- | --- | --- | --- | --- | --- |
| id | bigint(20) | false | primary_key | True | False |
| file_date | date | false | explicit | False | False |
| source_file | varchar(100) | false | explicit | False | False |
| records_read | int(11) | false | explicit | False | False |
| records_inserted | int(11) | false | explicit | False | False |
| records_skipped | int(11) | false | explicit | False | False |
| records_rejected | int(11) | false | explicit | False | False |
| imported_at | timestamptz | true | explicit | False | False |

Declared keys/indexes:

- primary `PRIMARY`: id asc
- unique `uk_xl_source_file`: source_file asc
