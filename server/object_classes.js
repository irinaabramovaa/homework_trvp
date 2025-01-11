class App {
    #orders = [];

    init() {
        document.getElementById('choose-date-bill')
            .addEventListener('click', (event) => {
                console.log(event.target.style.display = 'none');

                const input = document.getElementById('choose-date-bill');
                input.style.display = 'initial';
                input.focus();
            });
    }
}


class OrderList {
    #orderID = '';
    #orderBuyer = '';
    #orderDate = '';
    #orderNotes = [];

    constructor({
                    billlistID,
                    buyerName,
                    billlistDate
                }) {
        this.#orderID = billlistID;
        this.#orderBuyer = buyerName;
        this.#orderDate = billlistDate;
    }
}

class OrderNote {

}