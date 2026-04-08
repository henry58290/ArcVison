// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract PredictionMarket {

    enum MarketStatus { Open, Resolved, Cancelled }

    struct Market {
        string       question;
        uint256      endTime;
        uint256      resolutionDeadline;
        uint256      totalYes;
        uint256      totalNo;
        uint256      totalTrades;
        MarketStatus status;
        bool         outcome;
        address      creator;
        uint8        category;
    }

    struct MarketSummary {
        uint256      marketId;
        string       question;
        uint256      endTime;
        uint256      resolutionDeadline;
        uint256      totalYes;
        uint256      totalNo;
        uint256      totalVolume;
        uint256      totalTrades;
        MarketStatus status;
        bool         outcome;
        address      creator;
        uint256      yesOdds; // scaled ×10000, e.g. 6667 = 66.67%
        uint256      noOdds;
        uint8        category;
    }

    // ------------------------------------------------------------------
    // Snapshot of a cancelled market, kept after the struct is deleted.
    // Lets the UI display cancelled markets and bettors check their refund.
    // ------------------------------------------------------------------
    struct CancelledMarketInfo {
        uint256 marketId;
        string  question;
        uint256 cancelledAt;
        uint256 totalYesAtCancel;
        uint256 totalNoAtCancel;
        uint256 totalTradesAtCancel;
        string  reason;
        uint8   category;
    }

    struct UserPosition {
        uint256 marketId;
        uint256 yesAmount;
        uint256 noAmount;
        bool    claimed;
    }

    // ------------------------------------------------------------------
    // PendingRefund — one entry per cancelled market where the user has
    // an unclaimed refund. Returned by getUserPendingRefunds().
    // ------------------------------------------------------------------
    struct PendingRefund {
        uint256 marketId;
        string  question;
        string  reason;
        uint256 cancelledAt;
        uint256 yesRefund;   // user's YES bet in that market (wei)
        uint256 noRefund;    // user's NO bet in that market (wei)
        uint256 total;       // yesRefund + noRefund (wei)
        uint8   category;
    }

    // ------------------------------------------------------------------
    // AnalyticsDashboard — everything needed for an analytics page in
    // a single contract call. No stitching multiple calls together.
    // ------------------------------------------------------------------
    struct AnalyticsDashboard {
        // Market counts
        uint256 totalMarkets;
        uint256 openMarkets;
        uint256 resolvedMarkets;
        uint256 cancelledMarkets;
        // Volume (all in wei)
        uint256 totalVolume;        // cumulative net bets across all markets
        uint256 openVolume;         // live YES+NO pools in Open markets
        uint256 resolvedVolume;     // YES+NO pools locked in Resolved markets
        uint256 cancelledVolume;    // YES+NO pools at time of cancellation
        uint256 claimedVolume;      // ETH already paid out via claimWinnings
        uint256 refundedVolume;     // ETH already paid out via claimRefund
        uint256 feesEarned;         // cumulative protocol fees collected
        // Activity
        uint256 totalTrades;
        uint256 uniqueTraders;
    }

    // ------------------------------------------------------------------
    // UserClaimInfo — everything the frontend needs to render the claim
    // button in a single contract call. No stitching 4 calls together.
    // ------------------------------------------------------------------
    struct UserClaimInfo {
        uint256 marketId;
        string  question;
        bool    outcome;           // true = YES won, false = NO won
        uint256 userYesBet;        // user's YES position (wei)
        uint256 userNoBet;         // user's NO position (wei)
        uint256 userWinningBet;    // the bet on the winning side (wei)
        uint256 estimatedPayout;   // full reward if claimed now (wei)
        bool    hasClaimed;
        bool    isEligible;        // true if userWinningBet > 0 && !hasClaimed
        uint256 resolvedAt;        // Unix timestamp of resolution
        MarketStatus status;
        uint8   category;
    }

    struct GlobalStats {
        uint256 totalMarkets;
        uint256 totalResolvedMarkets;
        uint256 totalCancelledMarkets;
        uint256 totalVolume;          // cumulative net bet volume (wei)
        uint256 totalTrades;          // cumulative trade count
        uint256 totalFeesEarned;      // cumulative protocol fees (wei)
        uint256 cancelledVolume;      // sum of pool sizes at cancel time (wei)
        uint256 uniqueTraders;        // distinct addresses that ever bet
        uint256 claimedVolume;        // total ETH paid out via claimWinnings (wei)
        uint256 refundedVolume;       // total ETH paid out via claimRefund (wei)
    }

    address public immutable owner;
    uint256 public feeBps;
    uint256 public accruedFees;
    uint256 public marketCount;

    mapping(uint256 => Market)                       public markets;
    mapping(uint256 => mapping(address => uint256))  public yesBets;
    mapping(uint256 => mapping(address => uint256))  public noBets;
    mapping(uint256 => mapping(address => bool))     public claimed;

    // Cancelled markets: struct is deleted to free storage, these survive.
    mapping(uint256 => bool)                         public isCancelled;
    mapping(uint256 => uint256)                      public cancelledAt;

    // Resolved market tracking — timestamp + ordered ID list for easy querying.
    mapping(uint256 => uint256)                      public resolvedAt;
    uint256[]                                        private _resolvedIds;

    // Cancelled market snapshots kept for UI display and refund checks.
    mapping(uint256 => string)                       private _cancelledQuestion;
    mapping(uint256 => uint256)                      private _cancelledTotalYes;
    mapping(uint256 => uint256)                      private _cancelledTotalNo;
    mapping(uint256 => uint256)                      private _cancelledTotalTrades;
    mapping(uint256 => string)                       private _cancelledReason;
    uint256[]                                        private _cancelledIds;
    mapping(uint256 => uint8)                        private _cancelledCategory;

    mapping(address => uint256[])                    private _userMarkets;
    mapping(uint256 => mapping(address => bool))     private _userRecorded;

    uint256 public globalTotalVolume;
    uint256 public globalTotalTrades;
    uint256 public globalTotalFeesEarned;
    uint256 public globalResolvedCount;
    uint256 public globalCancelledCount;

    // Analytics accumulators — all updated inline at the point of action.
    uint256 public globalCancelledVolume;  // sum of YES+NO pools at cancel time
    uint256 public globalUniqueTraders;    // count of addresses that ever placed a bet
    uint256 public globalClaimedVolume;    // total ETH paid out via claimWinnings
    uint256 public globalRefundedVolume;   // total ETH paid out via claimRefund

    uint256 public constant MAX_DURATION      = 365 days;
    uint256 public constant RESOLUTION_WINDOW = 3 days;
    uint256 public constant FEE_DENOMINATOR   = 100_000;
    uint256 public constant DEFAULT_FEE       = 25;
    uint256 public constant MAX_FEE_BPS       = 2_500;
    uint256 public constant MIN_BET           = 0.001 ether;
    uint256 public constant ODDS_PRECISION    = 10_000;
    uint8   public constant CATEGORY_COUNT    = 6;

    // ------------------------------------------------------------------
    // VIRTUAL_LIQ — virtual liquidity dampener (in wei).
    //
    // Added to BOTH sides of the odds formula so early trades can never
    // spike YES or NO to 100%/0%. Acts as an imaginary baseline bet on
    // each side that fades in influence as real volume grows.
    //
    // Formula:
    //   yOdds = (totalYes + VIRTUAL_LIQ) * ODDS_PRECISION
    //           / (totalYes + totalNo + 2 * VIRTUAL_LIQ)
    //
    // Effect at different real volumes (VIRTUAL_LIQ = 1 ETH):
    //   No bets yet          →  50.00%  (not undefined)
    //   First bet 0.1 ETH Y  →  52.38%  (not 100%)
    //   First bet 1.0 ETH Y  →  66.67%  (not 100%)
    //   10 ETH Y vs 0 ETH N  →  91.67%  (high but not 100%)
    //   10 ETH Y vs 5 ETH N  →  63.64%  (smooth price discovery)
    //
    // Raise VIRTUAL_LIQ for smoother early movement (e.g. 5 ether).
    // Lower it to let large bets move price faster (e.g. 0.1 ether).
    // ------------------------------------------------------------------
    uint256 public constant VIRTUAL_LIQ = 1 ether;

    // -----------------------------------------------------------------------
    // EVENTS
    // -----------------------------------------------------------------------

    event MarketCreated(uint256 indexed marketId, string question, uint256 endTime, uint8 category);

    // PositionPlaced includes a price snapshot so the frontend can build a
    // Polymarket-style lightweight-charts chart purely from BlockScout logs.
    //   value = log.args.yesOdds / 10_000  →  e.g. 0.6667 (66.67 ¢)
    //   time  = log.timeStamp              →  Unix timestamp from BlockScout
    event PositionPlaced(
        uint256 indexed marketId,
        address indexed user,
        bool    side,
        uint256 amount,       // net amount after fee
        uint256 yesOdds,      // YES price after this trade, scaled ×10000
        uint256 noOdds,       // NO  price after this trade, scaled ×10000
        uint256 totalYes,     // YES pool size after this trade
        uint256 totalNo       // NO  pool size after this trade
    );

    // MarketResolved now includes pool snapshot and timestamp so the frontend
    // can update both admin and user UI immediately from the event alone —
    // no extra contract read needed after the tx confirms.
    event MarketResolved(
        uint256 indexed marketId,
        bool    outcome,
        uint256 totalYesAtResolve,
        uint256 totalNoAtResolve,
        uint256 resolvedAt
    );

    // MarketCancelled includes pool snapshot + reason so the UI can show
    // bettors exactly how much they are owed before they even call getRefundAmount.
    event MarketCancelled(
        uint256 indexed marketId,
        string  reason,
        uint256 totalYesAtCancel,
        uint256 totalNoAtCancel,
        uint256 cancelledAt
    );

    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);

    // RefundClaimed includes YES/NO breakdown for cleaner UI accounting.
    event RefundClaimed(
        uint256 indexed marketId,
        address indexed user,
        uint256 yesRefund,
        uint256 noRefund,
        uint256 totalRefund
    );

    event FeesWithdrawn(address indexed to, uint256 amount);
    event FeeUpdated(uint256 newFeeBps);

    // -----------------------------------------------------------------------
    // MODIFIERS
    // -----------------------------------------------------------------------

    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier marketExists(uint256 _id) {
        require(_id > 0 && _id <= marketCount, "Market does not exist");
        require(!isCancelled[_id], "Market was cancelled");
        _;
    }

    constructor() {
        owner  = msg.sender;
        feeBps = DEFAULT_FEE;
    }

    // -----------------------------------------------------------------------
    // OWNER — WRITE
    // -----------------------------------------------------------------------

    function createMarket(string calldata _question, uint256 _endTime, uint8 _category) external onlyOwner {
        require(bytes(_question).length > 0,                 "Empty question");
        require(_endTime > block.timestamp,                  "End time must be future");
        require(_endTime <= block.timestamp + MAX_DURATION,  "End time too far");
        require(_category < CATEGORY_COUNT,                  "Invalid category");

        uint256 id  = ++marketCount;
        uint256 end = _endTime;

        markets[id] = Market({
            question:           _question,
            endTime:            end,
            resolutionDeadline: end + RESOLUTION_WINDOW,
            totalYes:           0,
            totalNo:            0,
            totalTrades:        0,
            status:             MarketStatus.Open,
            outcome:            false,
            creator:            msg.sender,
            category:           _category
        });

        emit MarketCreated(id, _question, end, _category);
    }

    function resolveMarket(uint256 _marketId, bool _outcome) external onlyOwner marketExists(_marketId) {
        Market storage m = markets[_marketId];

        require(m.status == MarketStatus.Open, "Already finalised");
        // Owner can resolve any time while the market is Open — even before
        // endTime — e.g. if the real-world event concludes early.
        // The only hard deadline is resolutionDeadline (endTime + 3 days).
        // After that window the market should be cancelled instead.
        require(
            block.timestamp <= m.resolutionDeadline,
            "Resolution window has passed cancel this market instead"
        );

        m.status  = MarketStatus.Resolved;
        m.outcome = _outcome;
        resolvedAt[_marketId] = block.timestamp;
        _resolvedIds.push(_marketId);
        globalResolvedCount++;

        emit MarketResolved(_marketId, _outcome, m.totalYes, m.totalNo, block.timestamp);
    }

    // ------------------------------------------------------------------
    // cancelMarket  (owner only)
    //
    // Can be called any time the market is still Open — before OR after
    // endTime — e.g. bad question wording, data source gone, or any
    // other reason the owner deems necessary.
    //
    // Flow:
    //   1. Pool sizes are snapshotted into private mappings BEFORE the
    //      Market struct is deleted (freeing contract storage).
    //   2. yesBets / noBets mappings are preserved so every bettor can
    //      call claimRefund() to recover their net bet.
    //   3. The protocol fee paid at bet time is non-refundable — it
    //      already covered gas/protocol costs when the bet was placed.
    //
    // @param _marketId  ID of the market to cancel (must be Open)
    // @param _reason    Human-readable reason (stored on-chain, shown
    //                   in the UI and event explorer to bettors)
    // ------------------------------------------------------------------
    function cancelMarket(uint256 _marketId, string calldata _reason) external onlyOwner {
        require(_marketId > 0 && _marketId <= marketCount, "Market does not exist");
        require(!isCancelled[_marketId],                   "Already cancelled");
        require(
            markets[_marketId].status == MarketStatus.Open,
            "Cannot cancel a resolved market"
        );
        require(bytes(_reason).length > 0, "Reason required");

        Market storage m = markets[_marketId];

        // Snapshot pool state before deleting the struct
        uint256 snapYes    = m.totalYes;
        uint256 snapNo     = m.totalNo;
        uint256 snapTrades = m.totalTrades;
        string memory q    = m.question;
        uint8 snapCategory = m.category;

        // Mark as cancelled
        isCancelled[_marketId] = true;
        cancelledAt[_marketId] = block.timestamp;
        globalCancelledCount++;
        globalCancelledVolume += snapYes + snapNo;

        // Persist snapshot for UI and refund queries
        _cancelledQuestion[_marketId]    = q;
        _cancelledTotalYes[_marketId]    = snapYes;
        _cancelledTotalNo[_marketId]     = snapNo;
        _cancelledTotalTrades[_marketId] = snapTrades;
        _cancelledReason[_marketId]      = _reason;
        _cancelledIds.push(_marketId);
        _cancelledCategory[_marketId]    = snapCategory;

        // Free the Market struct storage (yesBets/noBets are preserved)
        delete markets[_marketId];

        emit MarketCancelled(_marketId, _reason, snapYes, snapNo, block.timestamp);
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Exceeds max fee of 2.5%");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function withdrawFees(address _to) external onlyOwner nonReentrant {
        require(_to != address(0), "Zero address");
        uint256 amount = accruedFees;
        require(amount > 0, "No fees");
        accruedFees = 0;
        _safeTransfer(_to, amount);
        emit FeesWithdrawn(_to, amount);
    }

    // -----------------------------------------------------------------------
    // USER — WRITE
    // -----------------------------------------------------------------------

    function placePosition(uint256 _marketId, bool _side) external payable nonReentrant marketExists(_marketId) {
        Market storage m = markets[_marketId];

        require(m.status == MarketStatus.Open, "Market not open");
        require(block.timestamp < m.endTime,   "Betting window closed");
        require(msg.value >= MIN_BET,          "Below minimum bet");

        uint256 fee    = (msg.value * feeBps) / FEE_DENOMINATOR;
        uint256 netBet = msg.value - fee;

        accruedFees           += fee;
        globalTotalFeesEarned += fee;

        if (_side) {
            yesBets[_marketId][msg.sender] += netBet;
            m.totalYes += netBet;
        } else {
            noBets[_marketId][msg.sender] += netBet;
            m.totalNo += netBet;
        }

        m.totalTrades++;
        globalTotalVolume += netBet;
        globalTotalTrades++;

        if (!_userRecorded[_marketId][msg.sender]) {
            _userRecorded[_marketId][msg.sender] = true;
            _userMarkets[msg.sender].push(_marketId);
            // First time this address bets on any market — count as new unique trader.
            if (_userMarkets[msg.sender].length == 1) {
                globalUniqueTraders++;
            }
        }

        // Compute price snapshot AFTER pools are updated.
        // Uses _calcOdds with virtual liquidity — no 100%/0% spikes.
        (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);

        emit PositionPlaced(
            _marketId,
            msg.sender,
            _side,
            netBet,
            yOdds,
            nOdds,
            m.totalYes,
            m.totalNo
        );
    }

    function claimWinnings(uint256 _marketId) external nonReentrant marketExists(_marketId) {
        Market storage m = markets[_marketId];

        require(m.status == MarketStatus.Resolved, "Market not resolved");
        require(!claimed[_marketId][msg.sender],   "Already claimed");

        uint256 userBet;
        uint256 winningPool;
        uint256 losingPool;

        if (m.outcome) {
            userBet     = yesBets[_marketId][msg.sender];
            winningPool = m.totalYes;
            losingPool  = m.totalNo;
        } else {
            userBet     = noBets[_marketId][msg.sender];
            winningPool = m.totalNo;
            losingPool  = m.totalYes;
        }

        require(userBet > 0, "No winning position");

        uint256 reward = (losingPool == 0)
            ? userBet
            : userBet + (userBet * losingPool) / winningPool;

        claimed[_marketId][msg.sender] = true;
        globalClaimedVolume += reward;
        _safeTransfer(msg.sender, reward);
        emit WinningsClaimed(_marketId, msg.sender, reward);
    }

    // ------------------------------------------------------------------
    // claimRefund  (anyone with a position in a cancelled market)
    //
    // Refunds the net bet amounts (YES + NO) the caller placed.
    // The protocol fee paid at bet time is non-refundable.
    // Reverts on a second call — claim tracking prevents double-refunds.
    // ------------------------------------------------------------------
    function claimRefund(uint256 _marketId) external nonReentrant {
        require(isCancelled[_marketId],          "Market not cancelled");
        require(!claimed[_marketId][msg.sender], "Already claimed");

        uint256 yesRefund = yesBets[_marketId][msg.sender];
        uint256 noRefund  = noBets[_marketId][msg.sender];
        uint256 total     = yesRefund + noRefund;

        require(total > 0, "Nothing to refund");

        claimed[_marketId][msg.sender] = true;
        globalRefundedVolume += total;
        _safeTransfer(msg.sender, total);

        emit RefundClaimed(_marketId, msg.sender, yesRefund, noRefund, total);
    }

    // -----------------------------------------------------------------------
    // READ — CANCELLED MARKETS
    // -----------------------------------------------------------------------

    // Returns the refundable amount for a user in a cancelled market.
    // Call from the UI before showing the "Claim Refund" button.
    function getRefundAmount(uint256 _marketId, address _user)
        external
        view
        returns (
            uint256 yesRefund,
            uint256 noRefund,
            uint256 total,
            bool    alreadyClaimed
        )
    {
        require(isCancelled[_marketId], "Market not cancelled");
        yesRefund      = yesBets[_marketId][_user];
        noRefund       = noBets[_marketId][_user];
        total          = yesRefund + noRefund;
        alreadyClaimed = claimed[_marketId][_user];
    }

    // Returns the stored snapshot for a single cancelled market.
    function getCancelledMarketInfo(uint256 _marketId)
        external
        view
        returns (CancelledMarketInfo memory info)
    {
        require(isCancelled[_marketId], "Market not cancelled");
        info = CancelledMarketInfo({
            marketId:            _marketId,
            question:            _cancelledQuestion[_marketId],
            cancelledAt:         cancelledAt[_marketId],
            totalYesAtCancel:    _cancelledTotalYes[_marketId],
            totalNoAtCancel:     _cancelledTotalNo[_marketId],
            totalTradesAtCancel: _cancelledTotalTrades[_marketId],
            reason:              _cancelledReason[_marketId],
            category:            _cancelledCategory[_marketId]
        });
    }

    // Returns snapshots for ALL cancelled markets.
    // Useful for a "Cancelled" tab or admin dashboard.
    function getCancelledMarkets()
        external
        view
        returns (CancelledMarketInfo[] memory list)
    {
        uint256 len = _cancelledIds.length;
        list = new CancelledMarketInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 id = _cancelledIds[i];
            list[i] = CancelledMarketInfo({
                marketId:            id,
                question:            _cancelledQuestion[id],
                cancelledAt:         cancelledAt[id],
                totalYesAtCancel:    _cancelledTotalYes[id],
                totalNoAtCancel:     _cancelledTotalNo[id],
                totalTradesAtCancel: _cancelledTotalTrades[id],
                reason:              _cancelledReason[id],
                category:            _cancelledCategory[id]
            });
        }
    }

    // -----------------------------------------------------------------------
    // READ — RESOLVED MARKETS
    // -----------------------------------------------------------------------

    // ------------------------------------------------------------------
    // getUserClaimInfo — single call for everything the claim UI needs.
    //
    // Returns all fields required to decide whether to show "Claim
    // Winnings", "Already Claimed", or "No Winning Position" — for
    // BOTH admin and user views — without any additional RPC calls.
    //
    // Reverts if the market is not resolved or does not exist.
    // ------------------------------------------------------------------
    function getUserClaimInfo(uint256 _marketId, address _user)
        external
        view
        returns (UserClaimInfo memory info)
    {
        require(_marketId > 0 && _marketId <= marketCount, "Market does not exist");
        require(!isCancelled[_marketId], "Market was cancelled");

        Market storage m = markets[_marketId];
        require(m.status == MarketStatus.Resolved, "Market not resolved yet");

        uint256 yesBet = yesBets[_marketId][_user];
        uint256 noBet  = noBets[_marketId][_user];
        uint256 winBet = m.outcome ? yesBet : noBet;
        uint256 winPool  = m.outcome ? m.totalYes : m.totalNo;
        uint256 losePool = m.outcome ? m.totalNo  : m.totalYes;

        uint256 payout = 0;
        if (winBet > 0) {
            payout = (losePool == 0)
                ? winBet
                : winBet + (winBet * losePool) / winPool;
        }

        bool hasClaimed_ = claimed[_marketId][_user];

        info = UserClaimInfo({
            marketId:         _marketId,
            question:         m.question,
            outcome:          m.outcome,
            userYesBet:       yesBet,
            userNoBet:        noBet,
            userWinningBet:   winBet,
            estimatedPayout:  payout,
            hasClaimed:       hasClaimed_,
            isEligible:       winBet > 0 && !hasClaimed_,
            resolvedAt:       resolvedAt[_marketId],
            status:           m.status,
            category:         m.category
        });
    }

    // ------------------------------------------------------------------
    // getResolvedMarkets — returns all resolved market summaries.
    // Mirror of getCancelledMarkets() for the Resolved tab.
    // ------------------------------------------------------------------
    function getResolvedMarkets()
        external
        view
        returns (MarketSummary[] memory list)
    {
        uint256 len = _resolvedIds.length;
        list = new MarketSummary[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 id = _resolvedIds[i];
            Market storage m = markets[id];
            uint256 volume = m.totalYes + m.totalNo;
            (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);
            list[i] = MarketSummary({
                marketId:           id,
                question:           m.question,
                endTime:            m.endTime,
                resolutionDeadline: m.resolutionDeadline,
                totalYes:           m.totalYes,
                totalNo:            m.totalNo,
                totalVolume:        volume,
                totalTrades:        m.totalTrades,
                status:             m.status,
                outcome:            m.outcome,
                creator:            m.creator,
                yesOdds:            yOdds,
                noOdds:             nOdds,
                category:           m.category
            });
        }
    }

    // -----------------------------------------------------------------------
    // READ — MARKETS
    // -----------------------------------------------------------------------

    function getMarketSummary(uint256 _marketId)
        external
        view
        marketExists(_marketId)
        returns (MarketSummary memory summary)
    {
        Market storage m = markets[_marketId];
        uint256 volume   = m.totalYes + m.totalNo;
        (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);

        summary = MarketSummary({
            marketId:           _marketId,
            question:           m.question,
            endTime:            m.endTime,
            resolutionDeadline: m.resolutionDeadline,
            totalYes:           m.totalYes,
            totalNo:            m.totalNo,
            totalVolume:        volume,
            totalTrades:        m.totalTrades,
            status:             m.status,
            outcome:            m.outcome,
            creator:            m.creator,
            yesOdds:            yOdds,
            noOdds:             nOdds,
            category:           m.category
        });
    }

    function getMarkets(uint256 _offset, uint256 _limit)
        external
        view
        returns (MarketSummary[] memory page, uint256 total)
    {
        total = marketCount;
        if (_limit > 100) _limit = 100;
        if (_offset >= total) return (new MarketSummary[](0), total);

        uint256 size = total - _offset;
        if (size > _limit) size = _limit;
        page = new MarketSummary[](size);

        for (uint256 i = 0; i < size; i++) {
            uint256 id = total - _offset - i;

            if (isCancelled[id]) {
                page[i].marketId  = id;
                page[i].status    = MarketStatus.Cancelled;
                page[i].category  = _cancelledCategory[id];
                continue;
            }

            Market storage m = markets[id];
            uint256 volume   = m.totalYes + m.totalNo;
            (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);

            page[i] = MarketSummary({
                marketId:           id,
                question:           m.question,
                endTime:            m.endTime,
                resolutionDeadline: m.resolutionDeadline,
                totalYes:           m.totalYes,
                totalNo:            m.totalNo,
                totalVolume:        volume,
                totalTrades:        m.totalTrades,
                status:             m.status,
                outcome:            m.outcome,
                creator:            m.creator,
                yesOdds:            yOdds,
                noOdds:             nOdds,
                category:           m.category
            });
        }
    }

    function getMarketsByStatus(MarketStatus _status)
        external
        view
        returns (MarketSummary[] memory result)
    {
        uint256 count;
        for (uint256 i = 1; i <= marketCount; i++) {
            if (_status == MarketStatus.Cancelled) {
                if (isCancelled[i]) count++;
            } else {
                if (!isCancelled[i] && markets[i].status == _status) count++;
            }
        }

        result = new MarketSummary[](count);
        uint256 idx;
        for (uint256 i = 1; i <= marketCount; i++) {
            if (_status == MarketStatus.Cancelled) {
                if (!isCancelled[i]) continue;
                result[idx].marketId  = i;
                result[idx].status    = MarketStatus.Cancelled;
                result[idx].category  = _cancelledCategory[i];
                idx++;
            } else {
                if (isCancelled[i] || markets[i].status != _status) continue;
                Market storage m = markets[i];
                uint256 volume   = m.totalYes + m.totalNo;
                (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);
                result[idx++] = MarketSummary({
                    marketId:           i,
                    question:           m.question,
                    endTime:            m.endTime,
                    resolutionDeadline: m.resolutionDeadline,
                    totalYes:           m.totalYes,
                    totalNo:            m.totalNo,
                    totalVolume:        volume,
                    totalTrades:        m.totalTrades,
                    status:             m.status,
                    outcome:            m.outcome,
                    creator:            m.creator,
                    yesOdds:            yOdds,
                    noOdds:             nOdds,
                    category:           m.category
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // READ — USER
    // -----------------------------------------------------------------------

    function getUserPositions(address _user)
        external
        view
        returns (UserPosition[] memory positions)
    {
        uint256[] storage ids = _userMarkets[_user];
        positions = new UserPosition[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            positions[i] = UserPosition({
                marketId:  id,
                yesAmount: yesBets[id][_user],
                noAmount:  noBets[id][_user],
                claimed:   claimed[id][_user]
            });
        }
    }

    function getUserStats(address _user)
        external
        view
        returns (
            uint256 totalBetVolume,
            uint256 marketsEntered,
            uint256 winningsClaimed_,
            uint256 unclaimedWinnings,
            uint256 pendingRefunds
        )
    {
        uint256[] storage ids = _userMarkets[_user];
        marketsEntered = ids.length;

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id  = ids[i];
            uint256 yes = yesBets[id][_user];
            uint256 no  = noBets[id][_user];
            totalBetVolume += yes + no;

            if (claimed[id][_user]) {
                winningsClaimed_++;
                continue;
            }

            if (isCancelled[id]) {
                pendingRefunds += yes + no;
                continue;
            }

            Market storage m = markets[id];
            if (m.status == MarketStatus.Resolved) {
                uint256 userBet  = m.outcome ? yes : no;
                uint256 winPool  = m.outcome ? m.totalYes : m.totalNo;
                uint256 losePool = m.outcome ? m.totalNo  : m.totalYes;
                if (userBet > 0) {
                    unclaimedWinnings += (losePool == 0)
                        ? userBet
                        : userBet + (userBet * losePool) / winPool;
                }
            }
        }
    }

    function getUserMarketIds(address _user) external view returns (uint256[] memory) {
        return _userMarkets[_user];
    }

    // -----------------------------------------------------------------------
    // READ — ANALYTICS & BATCH USER QUERIES
    // -----------------------------------------------------------------------

    // ------------------------------------------------------------------
    // getAnalytics
    // Single call that powers a full analytics dashboard — market counts,
    // all volume buckets, fees, trades, unique traders.
    // Zero extra RPC calls needed from the frontend.
    // ------------------------------------------------------------------
    function getAnalytics()
        external
        view
        returns (AnalyticsDashboard memory dash)
    {
        uint256 openVol;
        uint256 resolvedVol;
        uint256 openCount;

        for (uint256 i = 1; i <= marketCount; i++) {
            if (isCancelled[i]) continue;
            Market storage m = markets[i];
            uint256 vol = m.totalYes + m.totalNo;
            if (m.status == MarketStatus.Open) {
                openVol   += vol;
                openCount += 1;
            } else if (m.status == MarketStatus.Resolved) {
                resolvedVol += vol;
            }
        }

        dash = AnalyticsDashboard({
            totalMarkets:     marketCount,
            openMarkets:      openCount,
            resolvedMarkets:  globalResolvedCount,
            cancelledMarkets: globalCancelledCount,
            totalVolume:      globalTotalVolume,
            openVolume:       openVol,
            resolvedVolume:   resolvedVol,
            cancelledVolume:  globalCancelledVolume,
            claimedVolume:    globalClaimedVolume,
            refundedVolume:   globalRefundedVolume,
            feesEarned:       globalTotalFeesEarned,
            totalTrades:      globalTotalTrades,
            uniqueTraders:    globalUniqueTraders
        });
    }

    // ------------------------------------------------------------------
    // getUserPendingRefunds
    // Returns all cancelled markets where the connected user has an
    // unclaimed refund — with amounts, question, and reason in one call.
    // Use this to populate the Cancelled tab claim list.
    // ------------------------------------------------------------------
    function getUserPendingRefunds(address _user)
        external
        view
        returns (PendingRefund[] memory refunds)
    {
        uint256[] storage ids = _userMarkets[_user];
        uint256 count;

        // First pass: count eligible entries
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (isCancelled[id] && !claimed[id][_user]) {
                uint256 t = yesBets[id][_user] + noBets[id][_user];
                if (t > 0) count++;
            }
        }

        refunds = new PendingRefund[](count);
        uint256 idx;

        // Second pass: populate
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!isCancelled[id] || claimed[id][_user]) continue;
            uint256 yes = yesBets[id][_user];
            uint256 no  = noBets[id][_user];
            uint256 tot = yes + no;
            if (tot == 0) continue;

            refunds[idx++] = PendingRefund({
                marketId:   id,
                question:   _cancelledQuestion[id],
                reason:     _cancelledReason[id],
                cancelledAt: cancelledAt[id],
                yesRefund:  yes,
                noRefund:   no,
                total:      tot,
                category:   _cancelledCategory[id]
            });
        }
    }

    // ------------------------------------------------------------------
    // getUserAllClaimInfo
    // Returns UserClaimInfo for every resolved market the user has bet on.
    // Replaces N individual getUserClaimInfo calls with a single one.
    // Use this to render the user's full "My Positions" / claim history.
    // ------------------------------------------------------------------
    function getUserAllClaimInfo(address _user)
        external
        view
        returns (UserClaimInfo[] memory claims)
    {
        uint256[] storage ids = _userMarkets[_user];
        uint256 count;

        // First pass: count resolved markets
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!isCancelled[id] && markets[id].status == MarketStatus.Resolved) {
                count++;
            }
        }

        claims = new UserClaimInfo[](count);
        uint256 idx;

        // Second pass: populate
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (isCancelled[id]) continue;
            Market storage m = markets[id];
            if (m.status != MarketStatus.Resolved) continue;

            uint256 yesBet = yesBets[id][_user];
            uint256 noBet  = noBets[id][_user];
            uint256 winBet = m.outcome ? yesBet : noBet;
            uint256 winPool  = m.outcome ? m.totalYes : m.totalNo;
            uint256 losePool = m.outcome ? m.totalNo  : m.totalYes;

            uint256 payout = 0;
            if (winBet > 0) {
                payout = (losePool == 0)
                    ? winBet
                    : winBet + (winBet * losePool) / winPool;
            }

            bool hasClaimed_ = claimed[id][_user];

            claims[idx++] = UserClaimInfo({
                marketId:        id,
                question:        m.question,
                outcome:         m.outcome,
                userYesBet:      yesBet,
                userNoBet:       noBet,
                userWinningBet:  winBet,
                estimatedPayout: payout,
                hasClaimed:      hasClaimed_,
                isEligible:      winBet > 0 && !hasClaimed_,
                resolvedAt:      resolvedAt[id],
                status:          m.status,
                category:        m.category
            });
        }
    }

        // -----------------------------------------------------------------------
    // READ — GLOBAL / ODDS / MISC
    // -----------------------------------------------------------------------

    // ------------------------------------------------------------------
    // getTotalVolume
    // Returns the total ETH volume (in wei) traded across ALL markets
    // since deployment. Incremented on every placePosition net of fee.
    //
    // Frontend: formatEther(await contract.getTotalVolume())
    // ------------------------------------------------------------------
    function getTotalVolume() external view returns (uint256) {
        return globalTotalVolume;
    }

    // ------------------------------------------------------------------
    // getVolumeStats
    // Returns a breakdown of volume and trade counts in one call so the
    // frontend can populate a stats banner without multiple RPC calls.
    //
    // Returns:
    //   totalVolume      — cumulative net bet volume across all markets (wei)
    //   totalTrades      — cumulative trade count across all markets
    //   totalFeesEarned  — cumulative protocol fees collected (wei)
    //   openVolume       — sum of YES+NO pools across currently Open markets
    //   openMarkets      — number of currently Open markets
    // ------------------------------------------------------------------
    function getVolumeStats()
        external
        view
        returns (
            uint256 totalVolume,
            uint256 totalTrades,
            uint256 totalFeesEarned,
            uint256 openVolume,
            uint256 openMarkets
        )
    {
        totalVolume     = globalTotalVolume;
        totalTrades     = globalTotalTrades;
        totalFeesEarned = globalTotalFeesEarned;

        for (uint256 i = 1; i <= marketCount; i++) {
            if (isCancelled[i]) continue;
            Market storage m = markets[i];
            if (m.status == MarketStatus.Open) {
                openVolume  += m.totalYes + m.totalNo;
                openMarkets += 1;
            }
        }
    }

    // ------------------------------------------------------------------
    // getMarketVolume
    // Returns the YES pool, NO pool, and combined volume for a single
    // market. Works for both active and cancelled markets.
    //
    // For cancelled markets the pools are read from the snapshot mappings
    // since the Market struct was deleted on cancellation.
    // ------------------------------------------------------------------
    function getMarketVolume(uint256 _marketId)
        external
        view
        returns (
            uint256 totalYes,
            uint256 totalNo,
            uint256 totalVolume
        )
    {
        require(_marketId > 0 && _marketId <= marketCount, "Market does not exist");

        if (isCancelled[_marketId]) {
            totalYes   = _cancelledTotalYes[_marketId];
            totalNo    = _cancelledTotalNo[_marketId];
            totalVolume = totalYes + totalNo;
        } else {
            Market storage m = markets[_marketId];
            totalYes    = m.totalYes;
            totalNo     = m.totalNo;
            totalVolume = totalYes + totalNo;
        }
    }

    function getGlobalStats() external view returns (GlobalStats memory) {
        return GlobalStats({
            totalMarkets:          marketCount,
            totalResolvedMarkets:  globalResolvedCount,
            totalCancelledMarkets: globalCancelledCount,
            totalVolume:           globalTotalVolume,
            totalTrades:           globalTotalTrades,
            totalFeesEarned:       globalTotalFeesEarned,
            cancelledVolume:       globalCancelledVolume,
            uniqueTraders:         globalUniqueTraders,
            claimedVolume:         globalClaimedVolume,
            refundedVolume:        globalRefundedVolume
        });
    }

    function getTopMarketsByVolume(uint256 _n) external view returns (MarketSummary[] memory top) {
        if (_n > marketCount) _n = marketCount;
        top = new MarketSummary[](_n);

        uint256 minVol;
        uint256 minIdx;

        for (uint256 i = 1; i <= marketCount; i++) {
            if (isCancelled[i]) continue;

            Market storage m = markets[i];
            uint256 vol      = m.totalYes + m.totalNo;
            (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);

            MarketSummary memory ms = MarketSummary({
                marketId:           i,
                question:           m.question,
                endTime:            m.endTime,
                resolutionDeadline: m.resolutionDeadline,
                totalYes:           m.totalYes,
                totalNo:            m.totalNo,
                totalVolume:        vol,
                totalTrades:        m.totalTrades,
                status:             m.status,
                outcome:            m.outcome,
                creator:            m.creator,
                yesOdds:            yOdds,
                noOdds:             nOdds,
                category:           m.category
            });

            if (i <= _n) {
                top[i - 1] = ms;
                if (i == _n) (minVol, minIdx) = _findMin(top, _n);
            } else if (vol > minVol) {
                top[minIdx] = ms;
                (minVol, minIdx) = _findMin(top, _n);
            }
        }
    }

    function getTopMarketsByTrades(uint256 _n) external view returns (MarketSummary[] memory top) {
        if (_n > marketCount) _n = marketCount;
        top = new MarketSummary[](_n);

        uint256 minTrades;
        uint256 minIdx;

        for (uint256 i = 1; i <= marketCount; i++) {
            if (isCancelled[i]) continue;

            Market storage m = markets[i];
            uint256 trades   = m.totalTrades;
            uint256 vol      = m.totalYes + m.totalNo;
            (uint256 yOdds, uint256 nOdds) = _calcOdds(m.totalYes, m.totalNo);

            MarketSummary memory ms = MarketSummary({
                marketId:           i,
                question:           m.question,
                endTime:            m.endTime,
                resolutionDeadline: m.resolutionDeadline,
                totalYes:           m.totalYes,
                totalNo:            m.totalNo,
                totalVolume:        vol,
                totalTrades:        trades,
                status:             m.status,
                outcome:            m.outcome,
                creator:            m.creator,
                yesOdds:            yOdds,
                noOdds:             nOdds,
                category:           m.category
            });

            if (i <= _n) {
                top[i - 1] = ms;
                if (i == _n) (minTrades, minIdx) = _findMinTrades(top, _n);
            } else if (trades > minTrades) {
                top[minIdx] = ms;
                (minTrades, minIdx) = _findMinTrades(top, _n);
            }
        }
    }

    function hasUserBet(uint256 _marketId, address _user) external view returns (bool) {
        return _userRecorded[_marketId][_user];
    }

    function getOdds(uint256 _marketId)
        external
        view
        marketExists(_marketId)
        returns (uint256 yesOdds, uint256 noOdds)
    {
        Market storage m = markets[_marketId];
        (yesOdds, noOdds) = _calcOdds(m.totalYes, m.totalNo);
    }

    function estimatePayout(uint256 _marketId, bool _side, uint256 _amount)
        external
        view
        marketExists(_marketId)
        returns (uint256 estimatedPayout)
    {
        Market storage m  = markets[_marketId];
        uint256 netBet    = _amount - (_amount * feeBps) / FEE_DENOMINATOR;
        uint256 winPool   = _side ? m.totalYes + netBet : m.totalNo  + netBet;
        uint256 losePool  = _side ? m.totalNo           : m.totalYes;

        if (losePool == 0) return netBet;
        estimatedPayout = netBet + (netBet * losePool) / winPool;
    }

    // -----------------------------------------------------------------------
    // INTERNAL
    // -----------------------------------------------------------------------

    // ------------------------------------------------------------------
    // _calcOdds — single source of truth for odds with virtual liquidity.
    //
    // Always returns a value in [0, ODDS_PRECISION].
    // The virtual liquidity ensures neither side ever hits 0% or 100%
    // no matter how lopsided the real pools are.
    // ------------------------------------------------------------------
    function _calcOdds(uint256 _totalYes, uint256 _totalNo)
        internal
        pure
        returns (uint256 yesOdds, uint256 noOdds)
    {
        uint256 dampedYes = _totalYes + VIRTUAL_LIQ;
        uint256 dampedNo  = _totalNo  + VIRTUAL_LIQ;
        uint256 dampedTot = dampedYes + dampedNo;
        yesOdds = (dampedYes * ODDS_PRECISION) / dampedTot;
        noOdds  = ODDS_PRECISION - yesOdds;
    }

    function _safeTransfer(address _to, uint256 _amount) internal {
        (bool ok, ) = payable(_to).call{value: _amount}("");
        require(ok, "ETH transfer failed");
    }

    function _findMin(MarketSummary[] memory arr, uint256 len)
        internal
        pure
        returns (uint256 minVal, uint256 minIndex)
    {
        minVal = arr[0].totalVolume;
        for (uint256 i = 1; i < len; i++) {
            if (arr[i].totalVolume < minVal) {
                minVal   = arr[i].totalVolume;
                minIndex = i;
            }
        }
    }

    function _findMinTrades(MarketSummary[] memory arr, uint256 len)
        internal
        pure
        returns (uint256 minVal, uint256 minIndex)
    {
        minVal = arr[0].totalTrades;
        for (uint256 i = 1; i < len; i++) {
            if (arr[i].totalTrades < minVal) {
                minVal   = arr[i].totalTrades;
                minIndex = i;
            }
        }
    }

    receive() external payable {
        revert("Use placePosition");
    }
}
