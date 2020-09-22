import { BigInt, ethereum, log, Address } from "@graphprotocol/graph-ts"
import {
    Purchase as PurchaseEvent,
    Redeem as RedeemEvent,
    Transfer as TransferEvent,
    SetParameter as SetParameterEvent,
    SetManager as SetManagerEvent,
    IncreaseRedeemingShareBalance as IncreaseRedeemingShareBalanceEvent,
    DecreaseRedeemingShareBalance as DecreaseRedeemingShareBalanceEvent,
    FundContract
} from '../generated/mai-fund-graph/Fund';

import {
    Perpetual,
} from '../generated/mai-fund-graph/Perpetual';

import {
    RSITrendingStrategy,
} from '../generated/mai-fund-graph/RSITrendingStrategy';

import {
    fetchFund,
    fetchUser,
    fetchUserInFund,
    ZERO_BI,
    ZERO_BD,
    ONE_BD,
    ADDRESS_ZERO,
    FUND_LIST,
    isUSDCollateral
} from './utils'

import { Fund, Purchase, Redeem, Transaction, FundBlockData, FundHourData } from '../generated/schema';

export function handleSetParameter(event: SetParameterEvent): void {
    let fund = fetchFund(event.address)
    switch(event.params.key.toString()) {
        case "cap":
            fund.cap = event.params.value
            break
        case "redeemingLockPeriod":
            fund.redeemingLockPeriod = event.params.value
            break
        case "entranceFeeRate":
            fund.entranceFeeRate = event.params.value
            break
        case "streamingFeeRate":
            fund.streamingFeeRate = event.params.value
            break
        case "performanceFeeRate":
            fund.performanceFeeRate = event.params.value
            break
        case "globalRedeemingSlippage":
            fund.globalRedeemingSlippage = event.params.value
            break
        case "drawdownHighWaterMark":
            fund.drawdownHighWaterMark = event.params.value
            break
        case "leverageHighWaterMark":
            fund.leverageHighWaterMark = event.params.value
            break
        case "rebalanceSlippage":
            fund.rebalanceSlippage = event.params.value
            break
        case "rebalanceTolerance":
            fund.rebalanceTolerance = event.params.value
            break
        default:
            return
    }
    fund.save()
}

export function handleSetManager(event: SetManagerEvent): void {
    let fund = fetchFund(event.address)
    fund.manager = event.params.newManager.toHexString()
    fund.save()
}

export function handleTransfer(event:TransferEvent): void {
    let transactionHash = event.transaction.hash.toHexString()
    // user stats
    let from = event.params.from
    let userFrom = fetchUser(from)
    let userInFundFrom = fetchUserInFund(from, event.address)
    let to = event.params.to
    let userTo = fetchUser(to)
    let userInFundTo = fetchUserInFund(to, event.address)
    let fund = fetchFund(event.address)

    let transaction = Transaction.load(transactionHash)
    if (transaction == null) {
        transaction = new Transaction(transactionHash)
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp
        transaction.purchases = []
        transaction.redeems = []
    }
    // purchase
    if (from.toHexString() == ADDRESS_ZERO) {
        let purchases = transaction.purchases
        if (purchases.length === 0) {
            let purchase = new PurchaseEvent(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(purchases.length).toString())
            )
            purchase.transaction = transaction.id
            purchase.timestamp = transaction.timestamp
            purchase.fund = fund.id
            purchase.to = userTo.id
            purchase.userInFund = userInFundTo.id
            purchase.shareAmount = event.params.value
            purchase.save()

            purchases.push(purchase.id)
            transaction.purchases = purchases
            transaction.save()
        }
    }

    // redeem
    if (to.toHexString() == ADDRESS_ZERO) {
        let redeems = transaction.purchases
        if (redeems.length === 0) {
            let redeem = new RedeemEvent(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(redeems.length).toString())
            )
            redeem.transaction = transaction.id
            redeem.timestamp = transaction.timestamp
            redeem.fund = fund.id
            redeem.from = userFrom.id
            redeem.userInFund = userInFundFrom.id
            redeem.shareAmount = event.params.value
            redeem.save()

            redeems.push(redeem.id)
            transaction.redeems = redeems
            transaction.save()
        }
    }

    // swap
    if (from.toHexString() != ADDRESS_ZERO && to.toHexString() != ADDRESS_ZERO) {
        let swapedAssetValue = userInFundFrom.assetValue.div(userInFundFrom.shareAmount).times(userFrom.shareAmount.minus(event.params.value))
        userInFundFrom.shareAmount = userFrom.shareAmount.minus(event.params.value)
        userInFundFrom.assetValue = userInFundFrom.assetValue.minus(swapedAssetValue)
        userInFundFrom.save()
    
        userInFundTo.shareAmount = userTo.shareAmount.plus(event.params.value)
        userInFundTo.assetValue = userInFundTo.assetValue.plus(swapedAssetValue)
        userTo.save()
    }
}

export function handlePurchase(event: PurchaseEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let purchases = transaction.purchases
    let purchase = Purchase.load(purchases[purchases.length - 1])

    purchase.netAssetValuePerShare = event.params.netAssetValue
    purchase.logIndex = event.logIndex
    purchase.save()


    let userInFund = fetchUserInFund(event.params.trader, event.address)
    purchases = userInFund.purchases
    purchases.push(purchase.id)
    userInFund.purchases = purchases
    userInFund.shareAmount = userInFund.shareAmount.plus(event.params.shareAmount)
    userInFund.assetValue = userInFund.assetValue.plus(event.params.netAssetValue.toBigDecimal().times(event.params.shareAmount.toBigDecimal()))
    userInFund.save()

    let fund = fetchFund(event.address)
    if (fund.totalSupply == ZERO_BI) {
       fund.initNetAssetValuePerShare = event.params.netAssetValue.toBigDecimal() 
    }
    purchases = fund.purchases
    purchases.push(purchase.id)
    fund.purchases = purchases
    fund.totalSupply = fund.totalSupply.plus(event.params.shareAmount)
    fund.save()
}

export function handleRedeem(event: RedeemEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let redeems = transaction.redeems
    let redeem = Redeem.load(redeems[redeems.length - 1])

    redeem.returnedCollateral = event.params.returnedCollateral
    redeem.logIndex = event.logIndex
    redeem.save()

    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.shareAmount = userInFund.shareAmount.minus(event.params.shareAmount)
    userInFund.assetValue = userInFund.assetValue.minus(event.params.returnedCollateral)
    redeems = userInFund.redeems
    redeems.push(redeems.id)
    userInFund.redeems = redeems
    userInFund.save()

    let fund = fetchFund(event.address)
    fund.totalSupply = fund.totalSupply.minus(event.params.shareAmount)
    redeems = fund.redeems
    redeems.push(redeem.id)
    fund.redeems = redeems
    fund.save()
}

export function handleIncreaseRedeemingShareBalance(event: IncreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.plus(event.params.amount)
    userInFund.save()
}

export function handleDecreaseRedeemingShareBalance(event: DecreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.minus(event.params.amount)
    userInFund.save()
}

export function handleBlock(block: ethereum.Block): void {
    for (let i = 0; i < FUND_LIST.length; i++) {
        let blockData = new FundBlockData(
            FUND_LIST[i]
            .concat('-')
            .concat(block.number.toString())
        )

        let fund = Fund.load(FUND_LIST[i])

        blockData.timestamp = block.timestamp
        blockData.blockNumber = block.number
        blockData.fund = fund.id

        let fundContract = FundContract.bind(FUND_LIST[i])
        let netAssetValuePerShare = BigInt.fromI32(0)

        let callResult = fundContract.try_netAssetValuePerShare()
        if(callResult.reverted){
            log.warning("Get try_netAssetValuePerShare reverted at block: {}", [block.number.toString()])
        } else {
            netAssetValuePerShare = callResult.value
        }

        let perpetual = Perpetual.bind(fund.perpetual)
        let markPrice = ONE_BD
        callResult = perpetual.try_markPrice()
        if(callResult.reverted){
            log.warning("Get try_markPrice reverted at block: {}", [block.number.toString()])
        } else {
            markPrice = callResult.value
        }

        let netValueInUSD = ZERO_BD
        let netValue = ZERO_BD

        if (isUSDCollateral(fund.collateral)) {
            netValueInUSD = netAssetValuePerShare
            netValue = netAssetValuePerShare.times(markPrice)
        } else {
            netValueInUSD = netAssetValuePerShare.div(markPrice)
            netValue = netAssetValuePerShare
        }

        blockData.netAssetValuePerShareUSD = netValueInUSD
        blockData.netAssetValuePerShareUnderlying = netValue

        // rsi strategy for AutoTradingFund
        let nextTraget = ZERO_BI
        let currentRSI = ZERO_BI
        if (fund.RSITrendingStrategy != "") {
            let strategy = RSITrendingStrategy.bind(fund.RSITrendingStrategy)
            callResult = strategy.try_getCurrentRSI()
            if(callResult.reverted){
                log.warning("Get try_getCurrentRSI reverted at block: {}", [block.number.toString()])
            } else {
                currentRSI = callResult.value
            }

            callResult = strategy.try_getNextTarget()
            if(callResult.reverted){
                log.warning("Get try_getNextTarget reverted at block: {}", [block.number.toString()])
            } else {
                nextTraget = callResult.value
            }

            blockData.nextTraget = nextTraget
            blockData.currentRSI = currentRSI
        }
        
        blockData.save()


        // hour data
        let timestamp = block.timestamp.toI32()
        let hourIndex = timestamp / 3600
        let hourStartUnix = hourIndex * 3600
        let hourFundID = FUND_LIST[i]
        .concat('-')
        .concat(BigInt.fromI32(hourIndex).toString())
        let fundHourData = FundHourData.load(hourFundID)
        if (fundHourData == null) {
            let hourData = new FundHourData(hourFundID)
            hourData.hourStartUnix = hourStartUnix
            hourData.fund = fund.id
            hourData.netAssetValuePerShareUSD = netValueInUSD
            hourData.netAssetValuePerShareUnderlying = netValue
            hourData.nextTraget = nextTraget
            hourData.currentRSI = currentRSI
            hourData.save()
        }
    }
}
  
