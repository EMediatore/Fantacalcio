const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.static('public'));
const PORT = 3000;
const dbPath = path.join(__dirname, 'FantaDB.db3');
const db = new sqlite3.Database(dbPath);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname + '/public/index.html'));
});

app.get('/pagina2', (req, res) => {
    res.sendFile(__dirname + '/public/pagina2.html');
});

app.get('/estraiGiocatore', async (req, res) => {
    const ruoloScelto = req.query.ruolo;
    let filtroRuolo = "";

    switch (ruoloScelto) {
        case 'Por':
            filtroRuolo = "Ruolo = 'Por'";
            break;
        case 'Dif':
            filtroRuolo = "Ruolo IN ('Dc', 'Dc;Dd', 'Dd;Dc', 'Dd;Dc;E', 'Dd;Ds;Dc', 'Dd;Ds;E', 'Dd;E', 'Ds;Dc', 'Ds;Dc;E', 'Ds;E')";
            break;
        case 'Cen':
            filtroRuolo = "Ruolo IN ('C', 'C;T', 'C;W', 'C;W;T', 'E', 'E;C', 'E;W', 'M', 'M;C', 'T', 'W', 'W;T')";
            break;
        case 'Att':
            filtroRuolo = "Ruolo IN ('Pc', 'A', 'W;A', 'T;A')";
            break;
    }

    try {
        // Prima verifica se ci sono giocatori disponibili per l'estrazione
        const countRow = await getQuery(`SELECT COUNT(ID) AS availablePlayers FROM Giocatori WHERE ${filtroRuolo} AND (ID_estrazione IS NULL OR ID_estrazione = 0)`);
        
        if (countRow.availablePlayers === 0) {
            res.json({ message: `Tutti i ${ruoloScelto} sono stati estratti` });
            return;
        }

        const row = await getQuery(`SELECT ID, Nome, Ruolo, Squadra FROM Giocatori WHERE ${filtroRuolo} AND (ID_estrazione IS NULL OR ID_estrazione = 0) ORDER BY RANDOM() LIMIT 1`);
        console.log("Giocatore estratto:", row);
        
        const extractionRow = await getQuery(`SELECT MAX(ID_estrazione) AS maxID FROM Giocatori`);
        const newExtractionID = (extractionRow.maxID || 0) + 1;
        console.log("New Extraction ID:", newExtractionID);

        // Dopo aver estratto il giocatore
        await runQuery(`UPDATE Giocatori SET ID_current_player = 0 WHERE ID_current_player = 1`);
        await runQuery(`UPDATE Giocatori SET ID_current_player = 1 WHERE ID = ?`, [row.ID]);

        
        await runQuery(`UPDATE Giocatori SET ID_estrazione = ? WHERE ID = ?`, [newExtractionID, row.ID]);
        console.log("Estrazione ID aggiornato per il giocatore:", row.ID);
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/assegna', async (req, res) => {
    try {
        // Trova il giocatore attualmente in fase di assegnazione
        const currentPlayerRow = await getQuery(`SELECT * FROM Giocatori WHERE ID_current_player = 1`);
        if (!currentPlayerRow) {
            return res.status(400).json({ error: "Nessun giocatore pronto per l'assegnazione" });
        }

        const idGiocatore = currentPlayerRow.ID;
        const idSquadra = req.query.idSquadra;
        const prezzo = req.query.prezzo;
        console.log("Parametri di assegnazione:", idGiocatore, idSquadra, prezzo);

        // Ottieni l'ID di assegnazione più recente e calcola il nuovo ID
        const row = await getQuery(`SELECT MAX(ID_assegnazione) AS maxID FROM Giocatori`);
        const newAssignationID = (row.maxID || 0) + 1;
        console.log("New Assignation ID:", newAssignationID);

        // Assegna il giocatore alla squadra fantasy
        await runQuery(`UPDATE Giocatori SET ID_assegnazione = ?, ID_SquadraFanta = ?, Svincolato = 1, ID_current_player = 0 WHERE ID = ?`, [newAssignationID, idSquadra, idGiocatore]);
        console.log("Aggiornamento ID assegnazione per il giocatore:", idGiocatore);

        // Aggiorna il prezzo del giocatore
        await runQuery(`UPDATE Giocatori SET Prezzo = ? WHERE ID = ?`, [prezzo, idGiocatore]);
        console.log("Prezzo aggiornato per il giocatore:", idGiocatore);

        // Aggiorna il budget e il numero di giocatori nella rosa della squadra
        await runQuery(`UPDATE rose SET Budget = Budget - ?, In_Rosa = In_Rosa + 1 WHERE ID_Rosa = ?`, [prezzo, idSquadra]);
        console.log("Budget e In_Rosa aggiornati per la squadra:", idSquadra);

        // Restituisci il nome della squadra a cui è stato assegnato il giocatore
        const teamRow = await getQuery(`SELECT Nome FROM rose WHERE ID_Rosa = ?`, [idSquadra]);
        
        res.json({ NomeSquadra: teamRow.Nome, NomeGiocatore: currentPlayerRow.Nome });

    } catch (err) {
        console.error("Errore durante l'assegnazione del giocatore:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint per ottenere le informazioni dettagliate di un singolo giocatore
app.get('/getInfoGiocatore', async (req, res) => {
    const idGiocatore = req.query.id;

    if (!idGiocatore) {
        return res.status(400).json({ error: 'ID giocatore non fornito' });
    }

    try {
        const row = await getQuery(`SELECT Giocatori.*, rose.Nome AS NomeSquadra FROM Giocatori LEFT JOIN rose ON Giocatori.ID_SquadraFanta = rose.ID_Rosa WHERE Giocatori.ID = ?`, [idGiocatore]);

        await runQuery(`UPDATE Giocatori SET ID_current_player = 0 WHERE ID_current_player = 1`);
        await runQuery(`UPDATE Giocatori SET ID_current_player = 1 WHERE ID = ?`, [row.ID]);

                
        if (!row) {
            return res.status(404).json({ error: 'Giocatore non trovato' });
        }
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Endpoint per ottenere la lista di tutti i giocatori
// Endpoint per ottenere la lista di tutti i giocatori basata sul ruolo
app.get('/getListaGiocatori', async (req, res) => {
    const ruoloScelto = req.query.ruolo;
    let filtroRuolo = "";

    switch (ruoloScelto) {
        case 'Por':
            filtroRuolo = "Ruolo = 'Por'";
            break;
        case 'Dif':
            filtroRuolo = "Ruolo IN ('Dc', 'Dc;Dd', 'Dd;Dc', 'Dd;Dc;E', 'Dd;Ds;Dc', 'Dd;Ds;E', 'Dd;E', 'Ds;Dc', 'Ds;Dc;E', 'Ds;E')";
            break;
        case 'Cen':
            filtroRuolo = "Ruolo IN ('C', 'C;T', 'C;W', 'C;W;T', 'E', 'E;C', 'E;W', 'M', 'M;C', 'T', 'W', 'W;T')";
            break;
        case 'Att':
            filtroRuolo = "Ruolo IN ('Pc', 'A', 'W;A', 'T;A')";
            break;
        default:
            return res.status(400).json({ error: 'Ruolo non valido' });
    }

    try {
    const rows = await getQueryAll(`SELECT * FROM Giocatori WHERE ${filtroRuolo} ORDER BY Nome ASC`);
    res.json(rows);
} catch (err) {
    res.status(500).json({ error: err.message });
}

});

app.get('/setCurrentPlayer', async (req, res) => {
    try {
        const idGiocatore = req.query.id;
        const prezzo = req.query.prezzo;

        if (!idGiocatore || prezzo === undefined) {
            return res.status(400).json({ success: false, error: 'Parametri non forniti correttamente' });
        }

        // Imposta tutti gli altri giocatori come non correnti
        await runQuery(`UPDATE Giocatori SET ID_current_player = 0`);
        
        // Imposta il giocatore selezionato come corrente
        await runQuery(`UPDATE Giocatori SET ID_current_player = 1, Prezzo = ? WHERE ID = ?`, [prezzo, idGiocatore]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// Nuova funzione helper per eseguire le query e restituire tutti i risultati
function getQueryAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

app.get('/cancellaAssegnazione', async (req, res) => {
    try {
        // Trova il giocatore attualmente in fase di assegnazione
        const currentPlayerRow = await getQuery(`SELECT * FROM Giocatori WHERE ID_current_player = 1`);
        if (!currentPlayerRow) {
            return res.status(400).json({ error: "Nessun giocatore attualmente selezionato" });
        }

        const idGiocatore = currentPlayerRow.ID;
        const prezzo = currentPlayerRow.Prezzo;
        const idSquadra = currentPlayerRow.ID_SquadraFanta;

        // Cambia il valore di ID_SquadraFanta e Svincolato nella tabella Giocatori
        await runQuery(`UPDATE Giocatori SET ID_SquadraFanta = NULL, Svincolato = 0 WHERE ID = ?`, [idGiocatore]);
        
        // Aggiungi il prezzo del giocatore al budget della squadra nella tabella Rose e diminuisci il valore di In_Rosa
        await runQuery(`UPDATE Rose SET Budget = Budget + ?, In_Rosa = In_Rosa - 1 WHERE ID_Rosa = ?`, [prezzo, idSquadra]);

        res.json({ message: "Assegnazione cancellata con successo!" });
    } catch (err) {
        console.error("Errore durante la cancellazione dell'assegnazione:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/ultimoGiocatoreEstratto', async (req, res) => {
    try {
        // Trova l'ultimo giocatore estratto
        const lastExtractedPlayer = await getQuery(`SELECT * FROM Giocatori WHERE ID_estrazione = (SELECT MAX(ID_estrazione) FROM Giocatori)`);
        
        if (!lastExtractedPlayer) {
            return res.status(404).json({ error: "Nessun giocatore è stato estratto" });
        }

        // Resetta l'ID_current_player per tutti i giocatori
        await runQuery(`UPDATE Giocatori SET ID_current_player = 0`);

        // Imposta l'ID_current_player a 1 per l'ultimo giocatore estratto
        await runQuery(`UPDATE Giocatori SET ID_current_player = 1 WHERE ID = ?`, [lastExtractedPlayer.ID]);

        res.json(lastExtractedPlayer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/rosters', (req, res) => {
  db.all(
    `SELECT r.Nome AS Squadra, r.Budget, g.Ruolo, g.Nome AS Giocatore, g.Prezzo
     FROM Giocatori g
     INNER JOIN Rose r ON g.ID_SquadraFanta = r.ID_Rosa
     ORDER BY g.Ruolo`,
    (err, rows) => {
      if (err) {
        console.error(err.message);
        res.status(500).send('Internal Server Error');
        return;
      }

      const rosterMap = new Map();
      rows.forEach(row => {
        if (!rosterMap.has(row.Squadra)) {
          rosterMap.set(row.Squadra, {
            squadra: row.Squadra,
            budget: row.Budget,
            giocatori: [],
          });
        }

        rosterMap.get(row.Squadra).giocatori.push({
          ruolo: row.Ruolo,
          giocatore: row.Giocatore,
          prezzo: row.Prezzo,
        });
      });

      const rosters = Array.from(rosterMap.values());
      res.json(rosters);
    }
  );
});




app.listen(PORT, () => {
    console.log(`Server avviato su http://localhost:${PORT}`);
});

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
}