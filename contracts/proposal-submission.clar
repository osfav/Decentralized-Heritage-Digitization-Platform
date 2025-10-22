(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-TITLE u101)
(define-constant ERR-INVALID-DESCRIPTION u102)
(define-constant ERR-INVALID-LOCATION u103)
(define-constant ERR-INVALID-HERITAGE-TYPE u104)
(define-constant ERR-INVALID-HASH u105)
(define-constant ERR-PROPOSAL-NOT-FOUND u106)
(define-constant ERR-PROPOSAL-EXISTS u107)
(define-constant ERR-INVALID-STATUS-TRANSITION u108)
(define-constant ERR-PROPOSAL-CLOSED u109)

(define-constant STATUS-PENDING "pending")
(define-constant STATUS-APPROVED "approved")
(define-constant STATUS-REJECTED "rejected")
(define-constant STATUS-IN-PROGRESS "in-progress")
(define-constant STATUS-COMPLETED "completed")

(define-data-var next-proposal-id uint u0)

(define-map proposals
  uint
  {
    title: (string-ascii 120),
    description: (string-utf8 2000),
    location: (string-ascii 100),
    heritage-type: (string-ascii 50),
    initial-hash: (buff 32),
    submitter: principal,
    status: (string-ascii 20),
    created-at: uint,
    updated-at: uint,
    verified-at: (optional uint),
    task-count: uint,
    nft-minted: bool
  }
)

(define-map proposal-by-hash
  (buff 32)
  uint
)

(define-read-only (get-proposal (id uint))
  (map-get? proposals id)
)

(define-read-only (get-proposal-by-hash (hash (buff 32)))
  (map-get? proposal-by-hash hash)
)

(define-read-only (is-valid-status (status (string-ascii 20)))
  (or
    (is-eq status STATUS-PENDING)
    (is-eq status STATUS-APPROVED)
    (is-eq status STATUS-REJECTED)
    (is-eq status STATUS-IN-PROGRESS)
    (is-eq status STATUS-COMPLETED)
  )
)

(define-private (validate-title (title (string-ascii 120)))
  (and (> (len title) u0) (<= (len title) u120))
)

(define-private (validate-description (desc (string-utf8 2000)))
  (and (> (len desc) u0) (<= (len desc) u2000))
)

(define-private (validate-location (loc (string-ascii 100)))
  (and (> (len loc) u0) (<= (len loc) u100))
)

(define-private (validate-heritage-type (typ (string-ascii 50)))
  (and (> (len typ) u0) (<= (len typ) u50))
)

(define-private (validate-hash (hash (buff 32)))
  (is-eq (len hash) u32)
)

(define-public (submit-proposal
  (title (string-ascii 120))
  (description (string-utf8 2000))
  (location (string-ascii 100))
  (heritage-type (string-ascii 50))
  (initial-hash (buff 32))
)
  (let (
    (proposal-id (var-get next-proposal-id))
    (existing-id (map-get? proposal-by-hash initial-hash))
  )
    (asserts! (validate-title title) (err ERR-INVALID-TITLE))
    (asserts! (validate-description description) (err ERR-INVALID-DESCRIPTION))
    (asserts! (validate-location location) (err ERR-INVALID-LOCATION))
    (asserts! (validate-heritage-type heritage-type) (err ERR-INVALID-HERITAGE-TYPE))
    (asserts! (validate-hash initial-hash) (err ERR-INVALID-HASH))
    (asserts! (is-none existing-id) (err ERR-PROPOSAL-EXISTS))
    (map-set proposals proposal-id
      {
        title: title,
        description: description,
        location: location,
        heritage-type: heritage-type,
        initial-hash: initial-hash,
        submitter: tx-sender,
        status: STATUS-PENDING,
        created-at: block-height,
        updated-at: block-height,
        verified-at: none,
        task-count: u0,
        nft-minted: false
      }
    )
    (map-set proposal-by-hash initial-hash proposal-id)
    (var-set next-proposal-id (+ proposal-id u1))
    (print { event: "proposal-submitted", id: proposal-id, hash: initial-hash })
    (ok proposal-id)
  )
)

(define-public (update-proposal-status
  (proposal-id uint)
  (new-status (string-ascii 20))
)
  (let (
    (proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND)))
    (current-status (get status proposal))
  )
    (asserts! (is-eq (get submitter proposal) tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (is-valid-status new-status) (err ERR-INVALID-STATUS-TRANSITION))
    (asserts! (not (is-eq current-status STATUS-COMPLETED)) (err ERR-PROPOSAL-CLOSED))
    (asserts!
      (or
        (and (is-eq current-status STATUS-PENDING) (or (is-eq new-status STATUS-APPROVED) (is-eq new-status STATUS-REJECTED)))
        (and (is-eq current-status STATUS-APPROVED) (is-eq new-status STATUS-IN-PROGRESS))
        (and (is-eq current-status STATUS-IN-PROGRESS) (is-eq new-status STATUS-COMPLETED))
      )
      (err ERR-INVALID-STATUS-TRANSITION)
    )
    (map-set proposals proposal-id
      (merge proposal
        {
          status: new-status,
          updated-at: block-height,
          verified-at: (if (is-eq new-status STATUS-COMPLETED) (some block-height) (get verified-at proposal))
        }
      )
    )
    (print { event: "proposal-status-updated", id: proposal-id, status: new-status })
    (ok true)
  )
)

(define-public (increment-task-count (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND))))
    (asserts! (is-eq (get status proposal) STATUS-IN-PROGRESS) (err ERR-INVALID-STATUS-TRANSITION))
    (map-set proposals proposal-id
      (merge proposal { task-count: (+ (get task-count proposal) u1), updated-at: block-height })
    )
    (ok true)
  )
)

(define-public (mark-nft-minted (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND))))
    (asserts! (get nft-minted proposal) (err ERR-UNAUTHORIZED))
    (map-set proposals proposal-id
      (merge proposal { nft-minted: true, updated-at: block-height })
    )
    (ok true)
  )
)

(define-read-only (get-next-proposal-id)
  (ok (var-get next-proposal-id))
)