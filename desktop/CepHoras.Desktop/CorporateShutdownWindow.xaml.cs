using System.Windows;
using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;
public partial class CorporateShutdownWindow : Window
{
    public CorporateShutdownWindow()
    {
        InitializeComponent(); Loaded += async (_, _) => await Send(new("status"));
        Closed += (_, _) => Password.Clear();
    }
    private async void Submit_Click(object sender, RoutedEventArgs e)
    {
        if (Confirmed.IsChecked != true) { Status.Text = "Confirme que salvou seu trabalho antes de solicitar."; return; }
        var request = new ControlRequest("shutdown", Password.Password, true); Password.Clear();
        await Send(request);
    }
    private async void Cancel_Click(object sender, RoutedEventArgs e) => await Send(new("cancel"));
    private async Task Send(ControlRequest request)
    {
        Submit.IsEnabled = false; CancelShutdown.IsEnabled = false;
        try
        {
            var result = await ControlClient.Send(request);
            Status.Text = result.Message;
            Submit.IsEnabled = result.Active && result.Code != "scheduled";
        }
        catch { Status.Text = "O serviço local não respondeu com segurança. O desligamento não foi confirmado. Procure a TI ou consulte novamente antes de repetir."; }
        finally { CancelShutdown.IsEnabled = true; }
    }
}
